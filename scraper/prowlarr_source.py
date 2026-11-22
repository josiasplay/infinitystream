import requests
import urllib.parse
from config import TMDB_API_KEY

class ProwlarrSource:
    def __init__(self, api_key: str, base_url: str):
        self.name = "Prowlarr"
        self.base_url = base_url.rstrip('/')
        self.headers = {"X-Api-Key": api_key}

    def fetch(self, tmdb, budget):
        results = []
        # Busca os filmes populares DIRETO da API do TMDB (ignorando a classe do projeto)
        tmdb_url = f"https://api.themoviedb.org/3/movie/popular?api_key={TMDB_API_KEY}&language=pt-BR&page=1"
        
        try:
            resp_tmdb = requests.get(tmdb_url, timeout=10)
            resp_tmdb.raise_for_status()
            popular = resp_tmdb.json().get("results", [])
        except Exception as e:
            print(f"Erro ao buscar no TMDB: {e}")
            return results

        count = 0
        for movie in popular:
            if count >= budget:
                break
                
            title = movie.get("title")
            tmdb_id = movie.get("id")
            if not title:
                continue

            print(f"Buscando no Prowlarr: {title}")
            query = urllib.parse.quote(title)
            
            # Busca no Prowlarr (2000 = Filmes, 5000 = TV)
            url = f"{self.base_url}/api/v1/search?query={query}&categories=2000,5000"
            
            try:
                resp = requests.get(url, headers=self.headers, timeout=15)
                if resp.status_code == 200:
                    releases = resp.json()
                    magnets = []
                    for r in releases:
                        if r.get("magnetUrl"):
                            magnets.append({
                                "title": r.get("title"),
                                "magnet": r.get("magnetUrl"),
                                "size": r.get("size")
                            })
                    
                    if magnets:
                        results.append({
                            "tmdb_id": tmdb_id,
                            "title": title,
                            "releases": magnets
                        })
            except Exception as e:
                print(f"Erro no Prowlarr para {title}: {e}")
            
            count += 1
            
        return results
