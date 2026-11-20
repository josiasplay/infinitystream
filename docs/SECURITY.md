# Segurança

## Chaves e segredos

| Segredo | Onde fica | Exposição |
|---|---|---|
| TMDB API key | `keys/`, secret do GitHub, variável do Pages | **pública no bundle do frontend** (inevitável num site estático; o TMDB permite e é somente leitura) |
| Bridge token | `keys/bridge_token.txt`, `bridge/.env` (chmod 600) na VM, localStorage do seu navegador | privado, se você **não** usar `VITE_BRIDGE_TOKEN` |
| Chave SSH privada | só no seu PC (`keys/oracle_ssh_key`) | nunca deve ir para a VM nem para o git |

- O `.gitignore` ignora `keys/*` (exceto `.gitkeep` e `env.example`), `*.key`, `*.pem` e `.env*`.
- Antes do primeiro push, rode `git status` e confirme que nenhuma chave aparece.
- Se uma chave vazar: regenere o TMDB em *Settings → API*; para o token, rode `openssl rand -hex 32 >
  keys/bridge_token.txt` na VM e o setup de novo; para o SSH, troque a chave no painel da Oracle.

## Bridge

- **Autenticação:** header `X-Bridge-Token`, ou `?token=` para `<video>` e WebSocket, que não enviam
  headers. A comparação é em tempo constante (`crypto.timingSafeEqual`). O `/health` é público e não expõe dados sensíveis.
- **CORS:** somente `https://*.pages.dev`, `localhost` e as origens de `ALLOWED_ORIGINS`.
  O WebSocket do tracker também valida o `Origin`.
- **Rate limiting:** `express-rate-limit` (120 req/min por IP) e `limit_req` no Nginx (10 r/s,
  burst 40), mais o fail2ban banindo abusos (jail `nginx-limit-req`) e força bruta no SSH.
- **SSRF:** `torrent_url` só é aceita via HTTPS e com host em `ALLOWED_TORRENT_HOSTS`
  (padrão: archive.org, webtorrent.io).
- **Tracker fechado:** só aceita anúncios de torrents que a bridge está servindo.
- **Isolamento:** o Node escuta só em `127.0.0.1:3000`. O ufw libera apenas 22, 80 e 443 e nega o 3000.
  O TLS é feito pelo Nginx com Let's Encrypt, com renovação automática.
- **Recursos:** limite de torrents ativos, conexões, memória (PM2) e disco (LRU), para que um abuso não derrube a VM.

## Privacidade

- Ao participar de um enxame BitTorrent, **o IP da VM fica visível** para os outros peers.
  Use apenas conteúdo que você tem direito de baixar e compartilhar.
- No modo P2P, o IP do seu navegador fica visível para os peers WebRTC (inclusive a bridge).
- Trailers usam `youtube-nocookie.com`. As imagens vêm de `image.tmdb.org`.
- Para deixar o site privado, use o Cloudflare Access (veja `deploy/cloudflare-pages.md`).

## Responsabilidade

Este projeto é para uso pessoal e estudo. Ele não inclui, não recomenda e não integra indexadores de
conteúdo protegido. O usuário é o único responsável pelo conteúdo que adiciona ao catálogo e acessa.
Usar a infraestrutura (GitHub, Oracle, Cloudflare) para distribuir conteúdo sem licença viola os termos
desses serviços e pode levar ao encerramento das contas.
