"""Parse de nomes de release, filtro anti-CAM, deduplicação e ranking.

Espelha frontend/src/utils/{releaseParser,antiCamFilter,qualityRanker}.js —
mantenha os dois lados sincronizados.
"""
from __future__ import annotations

import math
import re

# Releases gravadas em cinema: nunca exibir
ANTI_CAM_RE = re.compile(
    r"(?<![a-z0-9])(CAM|CAMRip|HDCAM|HDTS|TS|TELESYNC|TC|TELECINE|DVDSCR|SCREENER|VHSRip)(?![a-z0-9])",
    re.IGNORECASE,
)

LANG_PT_RE = re.compile(r"(dublado|dual|\[brazilian\]|pt[-_. ]?br|nacional|portugu[eê]s)", re.IGNORECASE)
LANG_JP_RE = re.compile(r"(japanese|\bjap?\b|\bjpn\b|legendado)", re.IGNORECASE)

QUALITY_PATTERNS = [
    ("4K", re.compile(r"\b(4k|2160p|uhd)\b", re.IGNORECASE)),
    ("1080p", re.compile(r"\b1080[pi]\b", re.IGNORECASE)),
    ("720p", re.compile(r"\b720p\b", re.IGNORECASE)),
    ("480p", re.compile(r"\b(480p|sd|dvdrip|xvid)\b", re.IGNORECASE)),
]
CODEC_PATTERNS = [
    ("x265", re.compile(r"\b(x265|h[ .]?265|hevc)\b", re.IGNORECASE)),
    ("x264", re.compile(r"\b(x264|h[ .]?264|avc)\b", re.IGNORECASE)),
    ("AV1", re.compile(r"\bav1\b", re.IGNORECASE)),
]
SOURCE_PATTERNS = [
    ("REMUX", re.compile(r"\bremux\b", re.IGNORECASE)),
    ("BluRay", re.compile(r"\b(blu-?ray|bdrip|brrip)\b", re.IGNORECASE)),
    ("WEB-DL", re.compile(r"\bweb-?dl\b", re.IGNORECASE)),
    ("WEBRip", re.compile(r"\bweb-?rip\b", re.IGNORECASE)),
    ("HDTV", re.compile(r"\bhdtv\b", re.IGNORECASE)),
]

QUALITY_SCORE = {"4K": 100, "1080p": 80, "720p": 55, "480p": 30, "SD": 15}
SOURCE_SCORE = {"REMUX": 100, "BluRay": 90, "WEB-DL": 80, "WEBRip": 65, "HDTV": 45, "Unknown": 30}
PT_BR_BONUS = 15


def is_cam(title: str) -> bool:
    # Normaliza separadores para que "Filme.2024.HDTS" case com \b
    return bool(ANTI_CAM_RE.search(re.sub(r"[._\-]", " ", title)))


def _first(patterns, text: str, default: str) -> str:
    for name, rx in patterns:
        if rx.search(text):
            return name
    return default


def parse_release(title: str, is_anime: bool = False, default_language: str | None = None) -> dict:
    norm = re.sub(r"[._]", " ", title)
    if LANG_PT_RE.search(norm):
        language = "pt-BR"
    elif default_language:
        language = default_language
    elif is_anime and LANG_JP_RE.search(norm):
        language = "ja"
    elif is_anime:
        language = "ja"
    else:
        language = "en"
    return {
        "quality": _first(QUALITY_PATTERNS, norm, "SD"),
        "codec": _first(CODEC_PATTERNS, norm, "Unknown"),
        "source": _first(SOURCE_PATTERNS, norm, "Unknown"),
        "language": language,
        "dual_audio": bool(re.search(r"\bdual\b", norm, re.IGNORECASE)),
    }


def score_release(release: dict) -> float:
    """score = seeders*0.5 + quality*0.3 + source*0.2 + bônus pt-BR.

    Seeders são comprimidos em escala log (0..100) para que um torrent com
    5000 seeds não esmague totalmente a qualidade. Fontes webseed (Internet
    Archive) contam como 50 seeders, pois o HTTP sempre serve o arquivo.
    """
    seeders = release.get("seeders")
    if seeders is None:
        seeders = 50 if release.get("webseed") else 0
    seed_component = min(100.0, math.log10(seeders + 1) * 33.3)
    score = (
        seed_component * 0.5
        + QUALITY_SCORE.get(release.get("quality"), 15) * 0.3
        + SOURCE_SCORE.get(release.get("source"), 30) * 0.2
    )
    if release.get("language") == "pt-BR":
        score += PT_BR_BONUS
    return round(score, 1)


def dedupe(releases: list[dict]) -> list[dict]:
    """Mesmo quality+language+source → fica só a release com mais seeders."""
    best: dict[tuple, dict] = {}
    for r in releases:
        key = (r.get("quality"), r.get("language"), r.get("source"))
        cur = best.get(key)
        if cur is None or (r.get("seeders") or 0) > (cur.get("seeders") or 0):
            best[key] = r
    return list(best.values())


def normalize(raw_releases: list[dict], is_anime: bool = False) -> list[dict]:
    """Aplica anti-CAM, parse, ranking e dedupe. Retorna ordenado por score."""
    out = []
    for raw in raw_releases:
        title = raw.get("title", "")
        if not title or is_cam(title):
            continue
        parsed = parse_release(title, is_anime=is_anime, default_language=raw.get("language"))
        rel = {**raw, **{k: v for k, v in parsed.items() if not raw.get(k)}}
        rel["score"] = score_release(rel)
        out.append(rel)
    return sorted(dedupe(out), key=lambda r: r["score"], reverse=True)
