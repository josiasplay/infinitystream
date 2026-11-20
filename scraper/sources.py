"""Fontes de releases para o catálogo.

Este projeto NÃO raspa indexadores de pirataria. As fontes são:

1. ManualSource   — catalog-sources/magnets.json, mantido por você, com
                    conteúdo que você tem direito de distribuir/assistir
                    (gravações próprias, Creative Commons, domínio público...).
2. InternetArchiveSource — coleção "feature_films" do archive.org (domínio
                    público/licenças abertas). Cada item tem um .torrent
                    oficial com webseed HTTP, então sempre há "seeder".

Para adicionar outra fonte legal, implemente `fetch(tmdb, budget)` retornando
uma lista de dicts {tmdb_id, type, title_pt_br, meta, releases: [...]}.
"""
from __future__ import annotations

import json
import time
import urllib.parse
from pathlib import Path

import requests

from tmdb_client import TMDBClient

PUBLIC_TRACKERS = [
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.btorrent.xyz",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
]


def build_magnet(infohash: str, name: str, webseed: str | None = None) -> str:
    parts = [f"xt=urn:btih:{infohash.lower()}", "dn=" + urllib.parse.quote(name)]
    parts += ["tr=" + urllib.parse.quote(t, safe="") for t in PUBLIC_TRACKERS]
    if webseed:
        parts.append("ws=" + urllib.parse.quote(webseed, safe=""))
    return "magnet:?" + "&".join(parts)


def tmdb_meta(details: dict, media_type: str) -> dict:
    """Recorte dos metadados TMDB guardado no catálogo (evita chamadas no frontend)."""
    date = details.get("release_date") or details.get("first_air_date") or ""
    return {
        "poster_path": details.get("poster_path"),
        "backdrop_path": details.get("backdrop_path"),
        "year": int(date[:4]) if date[:4].isdigit() else None,
        "genre_ids": [g["id"] for g in details.get("genres", [])] or details.get("genre_ids", []),
        "original_language": details.get("original_language"),
        "is_anime": media_type == "tv"
        and 16 in ([g["id"] for g in details.get("genres", [])] or details.get("genre_ids", []))
        and details.get("original_language") == "ja",
    }


class ManualSource:
    name = "manual"

    def __init__(self, path: Path):
        self.path = path

    def fetch(self, tmdb: TMDBClient, budget: int) -> list[dict]:
        if not self.path.is_file():
            print(f"[manual] {self.path} não existe — pulando")
            return []
        entries = json.loads(self.path.read_text(encoding="utf-8"))
        out = []
        for entry in entries[:budget]:
            try:
                media_type = entry.get("type", "movie")
                details = tmdb.details(media_type, int(entry["tmdb_id"]))
                release = {
                    "title": entry["title"],
                    "magnet": entry.get("magnet"),
                    "torrent_url": entry.get("torrent_url"),
                    "language": entry.get("language"),
                    "seeders": None,
                    "size_gb": entry.get("size_gb"),
                    "license": entry.get("license", "não informado"),
                    "origin": self.name,
                    "episode": entry.get("episode"),  # ex: "S01E02" para séries
                }
                out.append(
                    {
                        "tmdb_id": int(entry["tmdb_id"]),
                        "type": media_type,
                        "title_pt_br": details.get("title") or details.get("name"),
                        "meta": tmdb_meta(details, media_type),
                        "releases": [release],
                    }
                )
            except Exception as exc:  # tolerância a falhas: segue para o próximo
                print(f"[manual] erro em {entry.get('title')}: {exc}")
                out.append({"error": str(exc), "title": entry.get("title")})
        return out


class InternetArchiveSource:
    name = "internet_archive"
    SEARCH_URL = "https://archive.org/advancedsearch.php"

    def __init__(self, offset: int = 0):
        self.offset = offset
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "InfinityStream-catalog/1.0 (personal, non-commercial)"

    def fetch(self, tmdb: TMDBClient, budget: int) -> list[dict]:
        params = {
            "q": "collection:(feature_films) AND mediatype:(movies) AND year:[1900 TO 2030]",
            "fl[]": ["identifier", "title", "year", "item_size", "btih", "licenseurl"],
            "sort[]": "downloads desc",
            "rows": budget,
            "page": self.offset // max(budget, 1) + 1,
            "output": "json",
        }
        try:
            resp = self.session.get(self.SEARCH_URL, params=params, timeout=30)
            resp.raise_for_status()
            docs = resp.json()["response"]["docs"]
        except Exception as exc:
            print(f"[archive] busca falhou: {exc}")
            return [{"error": str(exc), "title": "archive.org search"}]

        out = []
        for doc in docs:
            ident = doc["identifier"]
            title = doc.get("title") or ident
            if isinstance(title, list):
                title = title[0]
            year = doc.get("year")
            try:
                match = tmdb.search_movie(title, int(year) if year else None)
                if not match:
                    continue
                time.sleep(0.1)  # gentileza com o archive.org
                webseed = "https://archive.org/download/"
                release = {
                    # Nome sintético para o parser (IA não segue padrão scene)
                    "title": f"{title}.{year or ''}.WEBRip.x264.[archive.org]",
                    "torrent_url": f"https://archive.org/download/{ident}/{ident}_archive.torrent",
                    "magnet": build_magnet(doc["btih"], ident, webseed) if doc.get("btih") else None,
                    "webseed": True,
                    "language": "en" if match.get("original_language") == "en" else match.get("original_language"),
                    "quality": "480p",
                    "seeders": None,
                    "size_gb": round(int(doc.get("item_size") or 0) / 1e9, 2),
                    "license": doc.get("licenseurl") or "Domínio público (archive.org)",
                    "origin": self.name,
                    "archive_id": ident,
                }
                out.append(
                    {
                        "tmdb_id": match["id"],
                        "type": "movie",
                        "title_pt_br": match.get("title"),
                        "meta": tmdb_meta(match, "movie"),
                        "releases": [release],
                    }
                )
            except Exception as exc:
                print(f"[archive] erro em {ident}: {exc}")
                out.append({"error": str(exc), "title": ident})
        return out
