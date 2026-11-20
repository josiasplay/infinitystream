# Arquitetura

## Componentes

| Componente | Onde roda | Tecnologia | Responsabilidade |
|---|---|---|---|
| Frontend | Cloudflare Pages | React 19, Vite 8, Tailwind 4, WebTorrent 3 (browser) | UI, metadados TMDB, escolha de release, player |
| Bridge | Oracle VM (1 OCPU / 1 GB) | Node 24, Express 5, webtorrent 3, bittorrent-tracker, PM2, Nginx | ponte WebRTC ↔ TCP/UDP, tracker WSS, streaming HTTP |
| Varredor | GitHub Actions | Python 3.11, requests | monta e revalida `catalog.json` |

## API da bridge

| Rota | Auth | Descrição |
|---|---|---|
| `GET /health` | não | `{status, uptime, active_torrents, memory_mb, cache_mb, ...}` |
| `POST /add` | sim | `{magnet}` ou `{torrent_url}` → `{infoHash, files, mainFileIndex, ws_url, magnet, stream_url}` |
| `GET /stats/:infoHash` | sim | progresso, peers, velocidade (também renova o LRU) |
| `GET /stream/:infoHash/:fileIndex` | sim (`?token=`) | bytes do arquivo com suporte a `Range` (fallback HTTP e legendas) |
| `WS /tracker` | sim (`?token=`) | tracker WebTorrent: sinalização WebRTC entre o navegador e a bridge |
| `GET /speedtest?bytes=N` | sim | N bytes aleatórios (no máximo 4 MB) para medir a banda |
| `DELETE /torrent/:infoHash` | sim | remove o torrent e os dados |

> A especificação original previa um `WS /stream/:infoHash`. No WebRTC, porém, o WebSocket só serve
> para sinalização; os dados trafegam no *datachannel*. Por isso o WebSocket é o tracker (`/tracker`), e
> `/stream` é o fallback HTTP.

## Fluxo de reprodução

```
Navegador                      Bridge (Oracle)                 Rede BitTorrent
   │ POST /add {magnet}            │                                │
   │──────────────────────────────▶│ client.add(magnet) ───────────▶│ peers TCP/uTP, DHT, webseeds
   │ {infoHash, ws_url, stream_url}│◀─ metadados ───────────────────│
   │◀──────────────────────────────│                                │
   │ [P2P] WebTorrent.add(magnet, announce: wss://bridge/tracker)   │
   │══ WSS /tracker (sinalização) ═│                                │
   │◀════ WebRTC datachannel ═════▶│ (bridge é peer híbrido)        │
   │  peças → service worker → <video src=/webtorrent/...>         │
   │ [HTTP fallback, após 20s sem dados]                            │
   │ GET /stream/:hash/:idx (Range)│ file.createReadStream(range)   │
   │◀──────────────────────────────│ (baixa só as peças pedidas)    │
```

### Por que `webtorrent` e não `webtorrent-hybrid`?

O `webtorrent-hybrid` foi descontinuado. Desde a v2, o `webtorrent` suporta WebRTC nativamente no Node
(via `node-datachannel`), além de TCP, uTP e DHT. Ele faz o mesmo papel com um pacote mantido.

### Por que um tracker embutido?

O navegador só conversa com peers WebRTC. Para que ele encontre a bridge, os dois precisam anunciar no
mesmo tracker WebSocket. A bridge embute um (`bittorrent-tracker` em modo `noServer`, rota `/tracker`).
Ele aceita apenas torrents que a própria bridge serve e exige o token.

### Por que existe o modo HTTP?

O WebRTC pode falhar com NAT simétrico, CGNAT de operadora ou firewall corporativo, já que não há
servidor TURN (TURN gratuito e confiável não existe). O `/stream` com `Range` também é Direct Play:
o navegador recebe os bytes originais do arquivo. O modo **auto** tenta P2P e cai para HTTP em 20s.

### Service worker

O WebTorrent v2+ entrega os bytes ao `<video>` por um service worker (`webtorrent/dist/sw.min.js`).
O plugin em `vite.config.js` publica esse arquivo como `/webtorrent-sw.min.js`, e o `public/sw.js`
(que também faz o cache do PWA) o importa com `importScripts`.

## Escolha de release

1. `useNetworkQuality` mede o ping (mediana de 3 `/health`) e a banda (download de 2 MB em `/speedtest`).
   O `navigator.connection.downlink` é só um fallback, porque o Chrome o limita a 10 Mbps.
2. `maxQualityFor(mbps)`: acima de 25 → 4K, acima de 8 → 1080p, acima de 4 → 720p, senão 480p.
3. `rankReleases`: score do scraper + idioma (pt-BR → en/ja) + DUAL, com penalidade para qualidade
   acima da banda e para HEVC quando o navegador não decodifica.
4. O usuário pode sobrescrever a qualidade e o idioma. No player, troca faixa de áudio
   (`video.audioTracks`), legendas e release.

## Varredor

```
fontes legais ──▶ release_filter.normalize ──▶ catalog_builder.merge ──▶ validate ──▶ catalog.json
  ManualSource      anti-CAM (regex)             preserva added_at        UDP scrape (BEP 15)
  InternetArchive   idioma/qualidade/codec/fonte dedupe por infohash      HEAD nos .torrent
                    dedupe (q+lang+src), score   remove títulos vazios    remove após N dias mortos
```

Score: `seeders_log*0.5 + qualidade*0.3 + fonte*0.2 + 15 (pt-BR)`, com os seeders em escala log
(0 a 100) para não esmagar a qualidade. Webseeds valem 50 seeders.
Rotação: no máximo 100 títulos por execução, com o offset do Internet Archive em `catalog._state`.

### Como adicionar uma fonte

Implemente uma classe com `name` e `fetch(tmdb, budget) -> list[dict]` em `scraper/sources.py`,
retornando `{tmdb_id, type, title_pt_br, meta, releases: [{title, magnet|torrent_url, ...}]}`, e
registre-a em `main.py`. Use apenas fontes que distribuem o conteúdo legalmente.

## Orçamento de memória da VM (1 GB)

| Item | Aproximado |
|---|---|
| SO + Nginx + fail2ban | 250 MB |
| Bridge ociosa | 90 MB (medido) |
| Bridge com 2 a 4 torrents ativos | 250 a 500 MB |
| Swap | 2 GB (criado pelo setup) |

Limites: `--max-old-space-size=800`, `max_memory_restart: 850M`, `MAX_ACTIVE_TORRENTS=4` e
`MAX_CONNS=40`. Cache LRU em disco (`MAX_CACHE_GB=30`) com GC a cada 5 min. Torrents sem viewer
e sem acesso há 30 min são destruídos junto com os dados.
