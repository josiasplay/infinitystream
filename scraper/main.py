"""Entry point do varredor (GitHub Actions)."""
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
    load_key,
)
from sources import InternetArchiveSource, ManualSource  # noqa: E402
from tmdb_client import TMDBClient  # noqa: E402
from validate_links import validate  # noqa: E402
from prowlarr_source import ProwlarrSource  # noqa: E402

def main() -> int:
    started = time.monotonic()
    if not TMDB_API_KEY:
        print("ERRO: TMDB_API_KEY ausente")
        return 1

    tmdb = TMDBClient(TMDB_API_KEY)
    catalog = load_catalog(CATALOG_PATH)
    state = catalog.setdefault("_state", {})
    failures: list[str] = []

    sources = [ManualSource(MANUAL_SOURCES_PATH)]
    
    # Prowlarr: chave e URL vêm do ambiente (secrets do GitHub Actions) ou de keys/*.txt
    prowlarr_key = load_key("PROWLARR_API_KEY", "prowlarr_api_key.txt")
    prowlarr_url = load_key("PROWLARR_URL", "prowlarr_url.txt")
    if prowlarr_key and prowlarr_url:
        sources.append(ProwlarrSource(api_key=prowlarr_key, base_url=prowlarr_url, state=state))
    else:
        print("[main] PROWLARR_API_KEY/PROWLARR_URL ausentes — pulando o Prowlarr")

    # O budget agora vai dividir entre Manual e Prowlarr
    budget = MAX_TITLES_PER_RUN
    for source in sources:
        if budget <= 0 or time.monotonic() - started > MAX_RUNTIME_SECONDS:
            print("[main] orçamento de tempo/títulos esgotado")
            break
        print(f"[main] fonte: {source.name} (até {budget} títulos)")
        
        # Passa o budget restante para a fonte
        items = source.fetch(tmdb, budget)
        
        failures += [f"{source.name}: {i.get('title', 'Desconhecido')} → {i.get('error')}" for i in items if "error" in i]
        ok = [i for i in items if "error" not in i]
        
        merge(catalog, ok)
        budget -= len(ok)
        print(f"[main] {source.name}: {len(ok)} títulos processados")

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