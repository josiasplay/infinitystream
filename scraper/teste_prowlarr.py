import requests

API_KEY = "ade0bb896c314815b705396b58ee9884"
URL = "http://163.176.35.160:9696"
headers = {"X-Api-Key": API_KEY}

ids = ["2", "3", "4", "1"]
query = "vingadores"

# Monta a URL repetindo o parâmetro indexerIds
params = "".join([f"&indexerIds={i}" for i in ids])
url_busca = f"{URL}/api/v1/search?query={query}&type=search{params}"

print(f"URL de busca: {url_busca}")
resp = requests.get(url_busca, headers=headers, timeout=120)
print(f"Status: {resp.status_code}")

if resp.status_code == 200:
    dados = resp.json()
    if isinstance(dados, list):
        print(f"Resultados encontrados: {len(dados)}")
        if len(dados) > 0:
            print(f"Exemplo de título: {dados[0].get('title')}")
    elif isinstance(dados, dict) and "message" in dados:
        print(f"Erro do Prowlarr: {dados['message']}")
else:
    print("--- Corpo do erro ---")
    print(resp.text)