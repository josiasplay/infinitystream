"""Revalida releases do catálogo (link rot).

- Magnets: consulta seeders via *UDP tracker scrape* (BEP 15) nos trackers
  udp:// listados no próprio magnet. Sem dependências externas.
- .torrent via HTTP (Internet Archive): HEAD na URL; 404 = morto.

Uma release com 0 seeders (ou 404) ganha `zero_seeders_since`; se continuar
morta por DEAD_LINK_DAYS dias, é removida.

Pode rodar sozinho: python scraper/validate_links.py
"""
from __future__ import annotations

import os
import random
import socket
import struct
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(__file__))
from catalog_builder import load_catalog, now_iso, write_catalog  # noqa: E402
from config import CATALOG_PATH, DEAD_LINK_DAYS  # noqa: E402

PROTOCOL_ID = 0x41727101980


def udp_scrape(tracker: str, infohash_hex: str, timeout: float = 4.0) -> int | None:
    """Retorna o número de seeders segundo o tracker UDP, ou None se falhar."""
    parsed = urllib.parse.urlparse(tracker)
    if parsed.scheme != "udp" or not parsed.hostname or not parsed.port:
        return None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        addr = (socket.gethostbyname(parsed.hostname), parsed.port)
        # 1) connect
        tid = random.getrandbits(32)
        sock.sendto(struct.pack(">QII", PROTOCOL_ID, 0, tid), addr)
        data, _ = sock.recvfrom(16)
        action, rtid, conn_id = struct.unpack(">IIQ", data[:16])
        if action != 0 or rtid != tid:
            return None
        # 2) scrape
        tid = random.getrandbits(32)
        sock.sendto(struct.pack(">QII", conn_id, 2, tid) + bytes.fromhex(infohash_hex), addr)
        data, _ = sock.recvfrom(20)
        action, rtid, seeders, _completed, _leechers = struct.unpack(">IIIII", data[:20])
        return seeders if action == 2 and rtid == tid else None
    except (OSError, struct.error, ValueError):
        return None
    finally:
        try:
            sock.close()
        except Exception:
            pass


def magnet_seeders(magnet: str) -> int | None:
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(magnet).query)
    xt = next((x for x in qs.get("xt", []) if x.startswith("urn:btih:")), None)
    if not xt:
        return None
    infohash = xt.split(":")[-1].lower()
    if len(infohash) != 40:  # ignora btih base32
        return None
    results = [s for s in (udp_scrape(t, infohash) for t in qs.get("tr", [])[:3]) if s is not None]
    return max(results) if results else None


def http_alive(url: str) -> bool | None:
    try:
        resp = requests.head(url, allow_redirects=True, timeout=10)
        return resp.status_code < 400
    except requests.RequestException:
        return None  # erro de rede ≠ link morto


def validate(catalog: dict, max_checks: int = 300) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DEAD_LINK_DAYS)
    checked = removed = 0
    for entry in catalog.get("titles", {}).values():
        keep = []
        for rel in entry.get("releases", []):
            if checked >= max_checks:
                keep.append(rel)
                continue
            checked += 1
            alive = None
            if rel.get("webseed") and rel.get("torrent_url"):
                alive = http_alive(rel["torrent_url"])
            elif rel.get("magnet"):
                seeds = magnet_seeders(rel["magnet"])
                if seeds is not None:
                    rel["seeders"] = rel["last_seen_seeders"] = seeds
                    alive = seeds > 0
            if alive is False:
                rel.setdefault("zero_seeders_since", now_iso())
                since = datetime.fromisoformat(rel["zero_seeders_since"].replace("Z", "+00:00"))
                if since < cutoff:
                    removed += 1
                    print(f"[validate] removendo morto: {rel.get('title')}")
                    continue
            elif alive is True:
                rel.pop("zero_seeders_since", None)
            keep.append(rel)
        entry["releases"] = keep
    print(f"[validate] {checked} releases verificadas, {removed} removidas")
    return catalog


if __name__ == "__main__":
    cat = load_catalog(CATALOG_PATH)
    write_catalog(validate(cat), CATALOG_PATH)
