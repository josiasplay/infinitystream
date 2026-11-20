"""Entry point do varredor (GitHub Actions).

Fluxo:
 1. carrega chaves (env > keys/*.txt)
 2. coleta releases das fontes legais (manual + Internet Archive), rotacionando
 3. normaliza (anti-CAM, idioma, qualidade, codec, fonte), deduplica e ranqueia
 4. revalida links antigos
 5. grava frontend/public/catalog.json (o workflow faz commit/push)
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from catalog_builder import load_catalog, merge, write_catalog  # noqa: E402
from config import (  # noqa: E402
    CATALOG_PATH,
    ENABLE_INTERNET_ARCHIVE,
    MANUAL_SOURCES_PATH,
    MAX_RUNTIME_SECONDS,
    MAX_TITLES_PER_RUN,
    TMDB_API_KEY,
)
from sources import InternetArchiveSource, ManualSource  # noqa: E402
from tmdb_client import TMDBClient  # noqa: E402
from validate_links import validate  # noqa: E402


def main() -> int:
    started = time.monotonic()
    if not TMDB_API_KEY:
        print("ERRO: TMDB_API_KEY ausente (secret do GitHub ou keys/tmdb_api_key.txt)")
        return 1

    tmdb = TMDBClient(TMDB_API_KEY)
    catalog = load_catalog(CATALOG_PATH)
    state = catalog.setdefault("_state", {})
    failures: list[str] = []

    sources = [ManualSource(MANUAL_SOURCES_PATH)]
    if ENABLE_INTERNET_ARCHIVE:
        # Rotação: cada execução pega a próxima "página" da coleção
        offset = int(state.get("archive_offset", 0))
        sources.append(InternetArchiveSource(offset=offset))

    budget = MAX_TITLES_PER_RUN
    for source in sources:
        if budget <= 0 or time.monotonic() - started > MAX_RUNTIME_SECONDS:
            print("[main] orçamento de tempo/títulos esgotado")
            break
        print(f"[main] fonte: {source.name} (até {budget} títulos)")
        items = source.fetch(tmdb, budget)
        failures += [f"{source.name}: {i['title']} → {i['error']}" for i in items if "error" in i]
        ok = [i for i in items if "error" not in i]
        merge(catalog, ok)
        budget -= len(ok)
        print(f"[main] {source.name}: {len(ok)} títulos processados")
        if isinstance(source, InternetArchiveSource):
            # Volta ao início após ~2000 itens para revisitar os mais populares
            state["archive_offset"] = (source.offset + MAX_TITLES_PER_RUN) % 2000

    if time.monotonic() - started < MAX_RUNTIME_SECONDS:
        validate(catalog, max_checks=150)

    write_catalog(catalog, CATALOG_PATH)

    elapsed = time.monotonic() - started
    print(f"[main] concluído em {elapsed:.0f}s")
    if failures:
        print(f"[main] {len(failures)} falhas (não fatais):")
        for f in failures[:50]:
            print("   -", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
