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
                
            title_pt = movie.get("title")
            title_en = movie.get("original_title")
            tmdb_id = movie.get("id")
            
            # A MÁGICA ACONTECE AQUI: Usa o título em inglês para achar os torrents
            search_term = title_en if title_en else title_pt
            
            print(f"Buscando no Prowlarr: {title_pt} ({search_term})")
            query = urllib.parse.quote(search_term)
            
            url = f"{self.base_url}/api/v1/search?query={query}&categories=2000,5000"
            
            try:
                resp = requests.get(url, headers=self.headers, timeout=30)
                if resp.status_code == 200:
                    releases = resp.json()
                    magnets = []
                    for r in releases:
                        # Aceita tanto magnet link quanto link .torrent
                        link = r.get("magnetUrl") or r.get("downloadUrl")
                        
                        if link:
                            magnets.append({
                                "title": r.get("title"),
                                "magnet": link,
                                "size": r.get("size")
                            })
                    
                    if magnets:
                        results.append({
                            "tmdb_id": tmdb_id,
                            "title": title_pt,
                            "releases": magnets
                        })
                        print(f"  -> Encontrados {len(magnets)} links!")
            except Exception as e:
                print(f"Erro no Prowlarr para {search_term}: {e}")
            
            count += 1
            
        return results
