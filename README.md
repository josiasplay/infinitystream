# InfinityStream

Streaming pessoal **P2P** com metadados do **TMDB** em pt-BR. Não armazena nem transcodifica vídeo:
baixa por BitTorrent, toca no `<video>` nativo do navegador (Direct Play) e descarta.
Custo: **R$ 0,00/mês** (Cloudflare Pages + GitHub Actions + Oracle Cloud Free Tier).

> **Fontes de conteúdo.** O catálogo é montado a partir de fontes legais: a sua própria lista
> (`catalog-sources/magnets.json`, para conteúdo que você tem direito de usar) e a coleção de domínio
> público do Internet Archive. O projeto **não** inclui integração com indexadores de pirataria.
> Você é responsável pelo que adiciona.

```
┌──────────────────────────────────────────┐
│ CLOUDFLARE PAGES (React + Vite, estático)│
│  · metadados TMDB (pt-BR)                │
│  · catalog.json (gerado pelo Actions)    │
│  · player WebTorrent + <video> nativo    │
└───────┬──────────────────────┬───────────┘
        │ (1) metadados        │ (3) WebRTC (P2P)  ou  HTTP Range (fallback)
        ▼                      ▼
┌──────────────┐     ┌───────────────────────────────┐
│   TMDB API   │     │ ORACLE VM 1 OCPU / 1 GB       │
└──────────────┘     │  Nginx (TLS) → bridge Node.js │
                     │  webtorrent (WebRTC + TCP/UDP)│
                     │  tracker WSS embutido · PM2   │
                     └───────────────────────────────┘
                                   ▲ peers BitTorrent / webseeds
┌──────────────────────────────────┴───────┐
│ GITHUB ACTIONS (a cada 6h)               │
│  scraper Python: fontes legais → anti-CAM│
│  → idioma/qualidade → dedupe → ranking   │
│  → (2) commita frontend/public/catalog.json
└──────────────────────────────────────────┘
```

## Recursos

- Home com **Disponível para assistir**, Populares, Lançamentos, Séries e Animes (TMDB, pt-BR)
- Busca, detalhes com sinopse, elenco, trailer e pôster, e cache local de 24h dos metadados
- Escolha automática de **qualidade** (4K/1080p/720p/480p) pela banda medida até a bridge
- Prioridade de **idioma**: pt-BR (DUAL/Dublado/Nacional) → EN, ou → JP para animes, com override manual
- **Anti-CAM/TS/Telecine** em duas camadas (scraper e frontend)
- Player com seek, volume, tela cheia, legendas (`.srt` do torrent), faixas de áudio e troca de qualidade
- Métricas ao vivo: velocidade, peers, ping, buffer e progresso
- Modo P2P (WebRTC) com **fallback automático para HTTP** pela bridge
- PWA instalável

## Requisitos

Contas gratuitas: [TMDB](https://www.themoviedb.org/signup), [Oracle Cloud](https://www.oracle.com/cloud/free/),
[GitHub](https://github.com) e [Cloudflare](https://dash.cloudflare.com/sign-up). Também é preciso um
**domínio** (ou subdomínio gratuito, ex. DuckDNS) apontando para a VM, porque o HTTPS é obrigatório.

## Setup em 5 passos

1. **Chaves**: preencha `keys/` seguindo `keys/env.example`. O principal é `keys/tmdb_api_key.txt`
   (<https://www.themoviedb.org/settings/api>). Mova a chave SSH da Oracle para
   `keys/oracle_ssh_key` e `keys/oracle_ssh_key.pub`.
2. **VM Oracle**: crie uma VM Ubuntu (VM.Standard.E2.1.Micro), libere as portas 80/443 na VCN, aponte o
   DNS e rode `sudo -E bash deploy/oracle-setup.sh` ([docs/SETUP.md](docs/SETUP.md)).
3. **GitHub**: crie o secret `TMDB_API_KEY` e rode o workflow **Atualizar catálogo**
   ([deploy/github-actions-setup.md](deploy/github-actions-setup.md)).
4. **Cloudflare Pages**: build `cd frontend && npm install && npm run build`, saída `frontend/dist`
   ([deploy/cloudflare-pages.md](deploy/cloudflare-pages.md)).
5. **Primeiro acesso**: abra o site → ⚙ Configurações → informe a URL e o token da bridge → assista.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | passo a passo completo, do zero |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | componentes, fluxo de dados e decisões técnicas |
| [docs/SECURITY.md](docs/SECURITY.md) | chaves, token, CORS, firewall e privacidade |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | problemas comuns e soluções |

## Estrutura

```
frontend/                    React 19 + Vite + Tailwind (Cloudflare Pages)
bridge/                      Node.js + webtorrent + tracker WSS (Oracle VM, PM2)
scraper/                     Python (GitHub Actions) → frontend/public/catalog.json
catalog-sources/magnets.json sua lista de conteúdo legal
deploy/                      oracle-setup.sh e guias de deploy
keys/                        suas chaves (ignoradas pelo git)
```

## Keep-alive da Oracle

Instâncias Always Free ociosas por 7 dias (CPU no percentil 95 abaixo de 20%) podem ser recuperadas.
O `oracle-setup.sh` instala um cron com watchdog a cada 5 min, um `curl` externo a cada 6h e
cerca de 5 min/hora de CPU leve (`nice 19`). A alternativa mais robusta é converter a conta para
*Pay As You Go*: os recursos Always Free continuam gratuitos e deixam de ser recuperados.

## Licença

MIT. Metadados fornecidos pelo TMDB. Este produto usa a API do TMDB, mas não é endossado nem
certificado pelo TMDB.
