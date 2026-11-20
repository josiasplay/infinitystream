"""Carregamento de configuração: variáveis de ambiente primeiro, depois keys/*.txt."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
KEYS_DIR = ROOT / "keys"
CATALOG_PATH = ROOT / "frontend" / "public" / "catalog.json"
MANUAL_SOURCES_PATH = ROOT / "catalog-sources" / "magnets.json"

# .env opcional na raiz (útil para rodar localmente)
load_dotenv(ROOT / ".env")


def load_key(env_name: str, filename: str | None = None, required: bool = False) -> str | None:
    """Lê uma chave da variável de ambiente `env_name` ou do arquivo keys/<filename>."""
    value = os.getenv(env_name)
    if value:
        return value.strip()
    if filename:
        path = KEYS_DIR / filename
        if path.is_file():
            content = path.read_text(encoding="utf-8").strip()
            if content:
                return content
    if required:
        raise SystemExit(
            f"[config] Chave obrigatória ausente: defina {env_name} "
            f"ou crie keys/{filename or env_name.lower() + '.txt'}"
        )
    return None


TMDB_API_KEY = load_key("TMDB_API_KEY", "tmdb_api_key.txt")

# Limites de execução (GitHub Actions: alvo < 5 minutos)
MAX_TITLES_PER_RUN = int(os.getenv("MAX_TITLES_PER_RUN", "100"))
MAX_RUNTIME_SECONDS = int(os.getenv("MAX_RUNTIME_SECONDS", "270"))
# Remove releases com 0 seeders há mais de N dias
DEAD_LINK_DAYS = int(os.getenv("DEAD_LINK_DAYS", "7"))
# Habilita a fonte Internet Archive (domínio público)
ENABLE_INTERNET_ARCHIVE = os.getenv("ENABLE_INTERNET_ARCHIVE", "1") == "1"
