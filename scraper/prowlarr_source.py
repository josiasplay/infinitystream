import requests
import urllib.parse
import time
from config import TMDB_API_KEY

class ProwlarrSource:
    def __init__(self, api_key: str, base_url: str):
        self.name = "Prowlarr"
        self.base_url = base_url.rstrip('/')
        self.headers = {"X-Api-Key": api_key}
        self.indexer_ids = None

    def _get_indexer_ids(self):
        if self.indexer_ids is not None:
            return self.indexer_ids
        try:
            resp = requests.get(f"{self.base_url}/api/v1/indexer", headers=self.headers, timeout=30)
            if resp.status_code == 200:
                indexers = resp.json()
                self.indexer_ids = [str(idx['id']) for idx in indexers if idx['enable']]
                print(f"[Prowlarr] Indexadores ativos: {', '.join(self.indexer_ids)}")
        except Exception as e:
            print(f"[Prowlarr] Erro ao buscar indexadores: {e}")
            self.indexer_ids = []
        return self.indexer_ids

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

        ids = self._get_indexer_ids()
        if not ids:
            print("[Prowlarr] Nenhum indexador ativo encontrado. Abortando.")
            return results

        count = 0
        for movie in popular:
            if count >= budget:
                break
                
            title_pt = movie.get("title")
            title_en = movie.get("original_title")
            tmdb_id = movie.get("id")
            
            search_term = title_en if title_en else title_pt
            print(f"Buscando no Prowlarr: {title_pt} ({search_term})")
            query = urllib.parse.quote(search_term)
            
            all_magnets = []
            # Itera sobre cada indexador individualmente
            for indexer_id in ids:
                url = f"{self.base_url}/api/v1/search?query={query}&type=search&indexerIds={indexer_id}"
                try:
                    time.sleep(1)  # Pausa para não sobrecarregar
                    resp = requests.get(url, headers=self.headers, timeout=30)
                    if resp.status_code == 200:
                        releases = resp.json()
                        for r in releases:
                            link = r.get("magnetUrl") or r.get("downloadUrl")
                            if link:
                                all_magnets.append({
                                    "title": r.get("title"),
                                    "magnet": link,
                                    "size": r.get("size")
                                })
                    elif resp.status_code == 400:
                        # Se um indexador falhar com 400, apenas o ignoramos e continuamos
                        print(f"  -> Indexador {indexer_id} indisponível, ignorando.")
                except Exception as e:
                    print(f"  -> Erro no indexador {indexer_id}: {e}")
            
            if all_magnets:
                results.append({
                    "tmdb_id": tmdb_id,
                    "type": "movie",           # <--- CORRIGIDO AQUI
                    "title_pt_br": title_pt,   # <--- CORRIGIDO AQUI
                    "releases": all_magnets
                })
                print(f"  -> Encontrados {len(all_magnets)} links no total!")
            
            count += 1
            
        return results