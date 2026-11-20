"""Cliente mínimo da API TMDB v3 (pt-BR por padrão) com rate limiting."""
from __future__ import annotations

import threading
import time

import requests

BASE_URL = "https://api.themoviedb.org/3"


class TMDBClient:
    # TMDB permite ~50 req/s; ficamos bem abaixo (20 req/s) por segurança
    MIN_INTERVAL = 1 / 20

    def __init__(self, api_key: str, language: str = "pt-BR", region: str = "BR"):
        if not api_key:
            raise ValueError("TMDB_API_KEY ausente")
        self.api_key = api_key
        self.language = language
        self.region = region
        self.session = requests.Session()
        self._lock = threading.Lock()
        self._last = 0.0
        self._cache: dict[str, dict] = {}

    def _throttle(self) -> None:
        with self._lock:
            wait = self.MIN_INTERVAL - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()

    def get(self, path: str, **params) -> dict:
        params = {"api_key": self.api_key, "language": self.language, **params}
        key = path + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "api_key")
        if key in self._cache:
            return self._cache[key]
        for attempt in range(3):
            self._throttle()
            resp = self.session.get(f"{BASE_URL}{path}", params=params, timeout=15)
            if resp.status_code == 429:  # rate limit: respeita Retry-After
                time.sleep(int(resp.headers.get("Retry-After", "2")))
                continue
            resp.raise_for_status()
            data = resp.json()
            self._cache[key] = data
            return data
        raise RuntimeError(f"TMDB falhou repetidamente em {path}")

    # ---------- listas usadas para enriquecer/priorizar o catálogo ----------
    def trending_movies(self) -> list[dict]:
        return self.get("/trending/movie/week")["results"]

    def popular_tv(self) -> list[dict]:
        return self.get("/tv/popular")["results"]

    def anime(self) -> list[dict]:
        return self.get(
            "/discover/tv", with_genres=16, with_origin_country="JP", sort_by="popularity.desc"
        )["results"]

    # ---------- detalhes e busca ----------
    def details(self, media_type: str, tmdb_id: int) -> dict:
        return self.get(f"/{media_type}/{tmdb_id}")

    def search_movie(self, title: str, year: int | None = None) -> dict | None:
        params = {"query": title, "include_adult": "false"}
        if year:
            params["year"] = year
        results = self.get("/search/movie", **params).get("results", [])
        if not results and year:  # tenta sem ano (metadados antigos costumam divergir)
            results = self.get("/search/movie", query=title, include_adult="false").get("results", [])
        return results[0] if results else None
