"""Fonte Prowlarr: busca filmes do TMDB nos indexadores e devolve MAGNETS REAIS.

Por que esta versão existe:
- O Prowlarr quase nunca devolve "magnet:?..." direto no campo magnetUrl. Ele devolve um
  link PROXY dele mesmo (http://IP:9696/1/download?apikey=...&link=...). Esse link:
    * NÃO é magnet → a bridge responde 400 ou o parse-torrent quebra (erro 'info' null);
    * VAZA a API key do Prowlarr no catalog.json público.
  Aqui o link proxy é RESOLVIDO no scraper (redirect → magnet, ou .torrent → infohash)
  e só um magnet limpo vai para o catálogo.
- Uma única busca por filme com TODOS os indexadores (o Prowlarr consulta em paralelo),
  em vez de uma busca por indexador em sequência (era isso que estourava o tempo).
- Respeita um prazo total (MAX_RUNTIME_SECONDS) e um limite de títulos por execução,
  e avança a página do TMDB a cada execução para não buscar sempre os mesmos 20 filmes.
"""
from __future__ import annotations

import hashlib
import os
import re
import time
import unicodedata
import urllib.parse

import requests

from config import TMDB_API_KEY

# Trackers públicos adicionados aos magnets (ajudam a bridge a achar peers rápido)
PUBLIC_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "wss://tracker.webtorrent.dev",
    "wss://tracker.openwebtorrent.com",
]

MAGNET_RE = re.compile(r"^magnet:\?xt=urn:btih:([0-9a-fA-F]{40}|[A-Za-z2-7]{32})(?:&|$)")
SERIES_RE = re.compile(r"\bS\d{1,2}(E\d{1,3})?\b", re.I)
YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")


# ---------------------------------------------------------------- utilidades
def is_valid_magnet(link: str | None) -> bool:
    return bool(link) and bool(MAGNET_RE.match(link))


def build_magnet(info_hash: str, title: str, extra_trackers: list[str] | None = None) -> str:
    trackers = list(dict.fromkeys((extra_trackers or []) + PUBLIC_TRACKERS))
    parts = [f"xt=urn:btih:{info_hash.lower()}", "dn=" + urllib.parse.quote(title or info_hash)]
    parts += ["tr=" + urllib.parse.quote(t, safe="") for t in trackers]
    return "magnet:?" + "&".join(parts)


def clean_magnet(link: str, title: str) -> str:
    """Normaliza um magnet válido: mantém o hash e os trackers originais, soma os públicos."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
    info_hash = MAGNET_RE.match(link).group(1)
    return build_magnet(info_hash, (qs.get("dn") or [title])[0], qs.get("tr", []))


def _bdecode_end(data: bytes, i: int) -> int:
    """Retorna o índice logo após o valor bencode que começa em data[i]."""
    c = data[i:i + 1]
    if c == b"i":
        return data.index(b"e", i) + 1
    if c in (b"l", b"d"):
        i += 1
        while data[i:i + 1] != b"e":
            i = _bdecode_end(data, i)
        return i + 1
    if c.isdigit():
        colon = data.index(b":", i)
        return colon + 1 + int(data[i:colon])
    raise ValueError("bencode inválido")


def info_hash_from_torrent(data: bytes) -> str | None:
    """Calcula o infohash (SHA-1 do dicionário 'info') de um arquivo .torrent."""
    try:
        if data[:1] != b"d":
            return None
        i = 1
        while data[i:i + 1] != b"e":
            key_end = _bdecode_end(data, i)
            key = data[data.index(b":", i) + 1:key_end]
            val_end = _bdecode_end(data, key_end)
            if key == b"info":
                return hashlib.sha1(data[key_end:val_end]).hexdigest()
            i = val_end
    except (ValueError, IndexError):
        return None
    return None


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return " " + re.sub(r"[^a-z0-9]+", " ", text.lower()).strip() + " "


def title_matches(release_title: str, wanted_titles: list[str], year: int | None) -> bool:
    """O release tem o título procurado (palavra a palavra) e o ano bate (±1)?"""
    rel = _norm(release_title)
    if SERIES_RE.search(release_title):
        return False
    if not any(_norm(t).strip() and _norm(t) in rel for t in wanted_titles if t):
        return False
    if year:
        years = [int(y) for y in YEAR_RE.findall(release_title)]
        if years and not any(abs(y - year) <= 1 for y in years):
            return False
    return True


# ---------------------------------------------------------------- fonte
class ProwlarrSource:
    def __init__(self, api_key: str, base_url: str, state: dict | None = None):
        self.name = "Prowlarr"
        self.base_url = base_url.rstrip("/")
        self.headers = {"X-Api-Key": api_key}
        self.state = state if state is not None else {}
        self.indexer_ids: list[str] | None = None
        self.max_titles = int(os.getenv("PROWLARR_MAX_TITLES", "12"))
        self.max_releases = int(os.getenv("PROWLARR_MAX_RELEASES", "6"))
        self.search_timeout = int(os.getenv("PROWLARR_SEARCH_TIMEOUT", "90"))
        self.time_budget = int(os.getenv("MAX_RUNTIME_SECONDS", "270")) - 30  # folga p/ validar/gravar
        self.session = requests.Session()

    # -- indexadores ------------------------------------------------------
    def _get_indexer_ids(self) -> list[str]:
        if self.indexer_ids is not None:
            return self.indexer_ids
        self.indexer_ids = []
        try:
            resp = self.session.get(f"{self.base_url}/api/v1/indexer", headers=self.headers, timeout=(10, 30))
            if resp.status_code == 401:
                print("[Prowlarr] 401: API key errada (confira o secret PROWLARR_API_KEY).")
            resp.raise_for_status()
            self.indexer_ids = [str(i["id"]) for i in resp.json() if i.get("enable")]
            print(f"[Prowlarr] Indexadores ativos: {', '.join(self.indexer_ids) or 'nenhum'}")
        except Exception as e:  # noqa: BLE001
            print(f"[Prowlarr] Erro ao listar indexadores ({self.base_url}): {e}")
        return self.indexer_ids

    # -- TMDB -------------------------------------------------------------
    def _tmdb_movies(self) -> list[dict]:
        page = int(self.state.get("prowlarr_tmdb_page", 1))
        url = (f"https://api.themoviedb.org/3/movie/top_rated?api_key={TMDB_API_KEY}"
               f"&language=pt-BR&page={page}")
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:  # noqa: BLE001
            print(f"[Prowlarr] Erro no TMDB: {e}")
            return []
        total_pages = min(int(data.get("total_pages") or 1), 50)
        # próxima execução pega a página seguinte (volta à 1 depois da 50)
        self.state["prowlarr_tmdb_page"] = page + 1 if page < total_pages else 1
        print(f"[Prowlarr] TMDB top_rated página {page}")
        return data.get("results", [])

    # -- magnet -----------------------------------------------------------
    def _resolve_magnet(self, r: dict) -> str | None:
        title = r.get("title") or ""
        info_hash = (r.get("infoHash") or "").strip()
        if re.fullmatch(r"[0-9a-fA-F]{40}", info_hash):
            return build_magnet(info_hash, title)

        for key in ("magnetUrl", "downloadUrl"):
            link = r.get(key) or ""
            if is_valid_magnet(link):
                return clean_magnet(link, title)
            if not link.startswith("http"):
                continue
            try:
                # Link proxy do Prowlarr: ou redireciona para o magnet, ou entrega o .torrent
                resp = self.session.get(link, headers=self.headers, allow_redirects=False, timeout=(10, 25))
                location = resp.headers.get("Location", "")
                if is_valid_magnet(location):
                    return clean_magnet(location, title)
                if resp.status_code == 200:
                    h = info_hash_from_torrent(resp.content)
                    if h:
                        return build_magnet(h, title)
            except requests.RequestException as e:
                print(f"     ! não consegui resolver link de '{title[:50]}': {e.__class__.__name__}")
        return None

    # -- busca ------------------------------------------------------------
    def _search(self, query: str, ids: list[str]) -> list[dict]:
        params = [("query", query), ("type", "search"), ("limit", "100")]
        params += [("indexerIds", i) for i in ids]
        resp = self.session.get(f"{self.base_url}/api/v1/search", params=params,
                                headers=self.headers, timeout=(10, self.search_timeout))
        resp.raise_for_status()
        return resp.json()

    def fetch(self, tmdb, budget: int) -> list[dict]:
        started = time.monotonic()
        results: list[dict] = []

        ids = self._get_indexer_ids()
        if not ids:
            print("[Prowlarr] Nenhum indexador ativo. Abortando esta fonte.")
            return results

        for movie in self._tmdb_movies()[: min(budget, self.max_titles)]:
            if time.monotonic() - started > self.time_budget:
                print("[Prowlarr] Prazo de tempo atingido, continuo na próxima execução.")
                break

            title_pt = movie.get("title") or ""
            title_en = movie.get("original_title") or title_pt
            year = int(movie["release_date"][:4]) if movie.get("release_date") else None
            query = f"{title_en} {year}" if year else title_en
            print(f"Buscando no Prowlarr: {title_pt} ({query})")

            try:
                t0 = time.monotonic()
                raw = self._search(query, ids)
                print(f"  -> {len(raw)} resultados em {time.monotonic() - t0:.0f}s")
            except requests.Timeout:
                print(f"  -> Timeout após {self.search_timeout}s (indexador lento). Pulando.")
                continue
            except Exception as e:  # noqa: BLE001
                print(f"  -> Erro na busca: {e}")
                continue

            candidates = [r for r in raw if title_matches(r.get("title", ""), [title_en, title_pt], year)]
            candidates.sort(key=lambda r: r.get("seeders") or 0, reverse=True)

            releases, seen = [], set()
            for r in candidates[: self.max_releases * 2]:
                if len(releases) >= self.max_releases:
                    break
                magnet = self._resolve_magnet(r)
                if not magnet:
                    continue
                h = MAGNET_RE.match(magnet).group(1).lower()
                if h in seen:
                    continue
                seen.add(h)
                releases.append({
                    "title": r.get("title"),
                    "magnet": magnet,
                    "size": r.get("size"),
                    "seeders": r.get("seeders"),
                })

            if releases:
                results.append({
                    "tmdb_id": movie.get("id"),
                    "type": "movie",
                    "title_pt_br": title_pt,
                    "releases": releases,
                })
                print(f"  -> {len(releases)} magnets válidos!")
            else:
                print("  -> nenhum magnet válido para este título")

        return results
