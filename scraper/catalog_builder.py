"""Mescla resultados novos com o catalog.json existente e grava o arquivo."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from release_filter import normalize


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def release_key(r: dict) -> str:
    """Identidade estável de uma release: infohash do magnet, senão a URL do .torrent."""
    magnet = r.get("magnet") or ""
    if "btih:" in magnet:
        return magnet.split("btih:")[1].split("&")[0].lower()
    return r.get("torrent_url") or r.get("title", "")


def load_catalog(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"[catalog] {path} inválido — recomeçando do zero")
    return {"generated_at": None, "total_titles": 0, "titles": {}, "_state": {}}


def merge(catalog: dict, items: list[dict]) -> dict:
    titles = catalog.setdefault("titles", {})
    stamp = now_iso()
    for item in items:
        if "error" in item:
            continue
        tid = str(item["tmdb_id"])
        entry = titles.setdefault(
            tid,
            {"tmdb_id": item["tmdb_id"], "type": item["type"], "title_pt_br": item["title_pt_br"], "releases": []},
        )
        entry["title_pt_br"] = item["title_pt_br"] or entry.get("title_pt_br")
        entry.update(item.get("meta", {}))

        existing = {release_key(r): r for r in entry["releases"]}
        for rel in item["releases"]:
            key = release_key(rel)
            old = existing.get(key)
            rel["added_at"] = old["added_at"] if old else stamp
            rel["last_seen_seeders"] = rel.get("seeders") if rel.get("seeders") is not None else (
                old.get("last_seen_seeders") if old else None
            )
            if old:
                rel.setdefault("zero_seeders_since", old.get("zero_seeders_since"))
            existing[key] = {**(old or {}), **{k: v for k, v in rel.items() if v is not None}}

        entry["releases"] = normalize(list(existing.values()), is_anime=entry.get("is_anime", False))
        if not entry["releases"]:
            titles.pop(tid, None)
    return catalog


MAGNET_RE = re.compile(r"^magnet:\?xt=urn:btih:([0-9a-fA-F]{40}|[A-Za-z2-7]{32})(?:&|$)")


def playable(rel: dict) -> bool:
    """Só entra no catálogo o que a bridge consegue abrir: magnet real ou .torrent HTTPS.

    Remove, por exemplo, links proxy do Prowlarr (http://IP:9696/...?apikey=...) que
    caíram no campo "magnet" — eles quebram o Play e vazam a API key.
    """
    magnet = rel.get("magnet")
    if magnet and not MAGNET_RE.match(magnet):
        rel.pop("magnet", None)
    torrent_url = rel.get("torrent_url") or ""
    if torrent_url and not torrent_url.startswith("https://"):
        rel.pop("torrent_url", None)
    return bool(rel.get("magnet") or rel.get("torrent_url"))


def write_catalog(catalog: dict, path: Path) -> None:
    # Descarta releases não reproduzíveis e títulos sem releases (CAM, mortos, links quebrados)
    for entry in catalog.get("titles", {}).values():
        entry["releases"] = [r for r in entry.get("releases", []) if playable(r)]
    catalog["titles"] = {k: v for k, v in catalog.get("titles", {}).items() if v.get("releases")}
    catalog["generated_at"] = now_iso()
    catalog["total_titles"] = len(catalog["titles"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)  # escrita atômica
    print(f"[catalog] gravado {path} com {catalog['total_titles']} títulos")
