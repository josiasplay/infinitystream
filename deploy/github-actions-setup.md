# Configuração do GitHub Actions (varredor do catálogo)

Dois workflows:

| Arquivo | Quando roda | O que faz |
|---|---|---|
| `.github/workflows/catalog.yml` | a cada 6h, manual, ou ao editar `catalog-sources/` | coleta releases das fontes, filtra CAM/TS, ranqueia e commita `frontend/public/catalog.json` |
| `.github/workflows/validate.yml` | a cada 12h, ou manual | revalida os links (UDP tracker scrape e HEAD nos `.torrent`) e remove os mortos |

## 1. Secrets

Repositório → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Obrigatório | Valor |
|---|---|---|
| `TMDB_API_KEY` | sim | chave v3 do TMDB |

Opcionalmente, na aba **Variables**:

| Variable | Padrão | Uso |
|---|---|---|
| `MAX_TITLES_PER_RUN` | `100` | limite de títulos por execução (mantém cada execução abaixo de 5 min) |
| `ENABLE_INTERNET_ARCHIVE` | `1` | `0` desliga a fonte archive.org |
| `DEAD_LINK_DAYS` | `7` | dias com 0 seeders antes de remover a release |

## 2. Permissões

**Settings** → **Actions** → **General** → **Workflow permissions** → marque
**Read and write permissions**, para que o bot consiga fazer push do `catalog.json`.
Os workflows já declaram `permissions: contents: write`.

## 3. Primeira execução manual

1. Aba **Actions** → **Atualizar catálogo** → **Run workflow** → branch `main`.
2. Aguarde de 1 a 4 minutos. Um commit `chore(catalog): atualização automática [skip ci]` deve aparecer.
3. Confira o `frontend/public/catalog.json` atualizado.

## 4. Logs

Actions → clique na execução → job **scrape** → passo **Executar varredor**. Exemplo:

```
[main] fonte: manual (até 100 títulos)
[main] manual: 3 títulos processados
[main] fonte: internet_archive (até 97 títulos)
[main] internet_archive: 81 títulos processados
[validate] 150 releases verificadas, 0 removidas
[catalog] gravado .../catalog.json com 84 títulos
[main] concluído em 96s
```

Falhas em títulos individuais não derrubam a execução. Elas aparecem listadas no final.

## 5. Adicionar conteúdo próprio

Edite `catalog-sources/magnets.json` com conteúdo que você tem direito de usar (vídeos próprios,
Creative Commons, domínio público):

```json
{
  "tmdb_id": 45745,
  "type": "movie",
  "title": "Sintel.2010.1080p.WEB-DL.x264",
  "magnet": "magnet:?xt=urn:btih:...",
  "language": "en",
  "license": "CC BY 3.0"
}
```

O push dispara o workflow automaticamente. Para séries, use `"type": "tv"` e `"episode": "S01E01"`.

## 6. Cota

Repositório público: minutos ilimitados. Repositório privado: 2.000 min/mês, e o uso típico aqui é de
cerca de 4 execuções/dia × 3 min + 2 × 2 min ≈ 480 min/mês. Repositório público é recomendado,
desde que **sem chaves** (o `.gitignore` já protege `keys/`).
