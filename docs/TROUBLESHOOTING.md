# Solução de problemas

## Vídeo não carrega

1. **A bridge está no ar?** `curl https://bridge.seudominio.com/health`.
   - Sem resposta: confira a Security List da VCN (80/443), `sudo ufw status`, `sudo nginx -t` e `pm2 status`.
2. **"token inválido" (401):** o token em ⚙ Configurações difere de `keys/bridge_token.txt` na VM.
3. **Erro de CORS no console:** a origem do site não está liberada. Os domínios `*.pages.dev` são
   aceitos; para um domínio próprio, adicione-o a `keys/allowed_origins.txt` e rode o setup de novo.
4. **"Tempo esgotado buscando metadados":** o torrent não tem peers. Veja `pm2 logs` e teste outra release.
5. **Fica em "Conectando aos peers (WebRTC)…":** o WebRTC está bloqueado na sua rede (CGNAT,
   firewall). O modo **auto** cai para HTTP em 20s; para forçar, use ⚙ → Modo → *Somente HTTP*.
6. **Mixed content:** a bridge está em `http://`. O HTTPS é obrigatório (veja SETUP §4).
7. **Service worker:** o modo P2P precisa do SW ativo. Recarregue a página uma vez após o primeiro acesso
   ou limpe em DevTools → Application → Service Workers.

## Bridge cai ou reinicia

```bash
pm2 status
pm2 logs infinitystream-bridge --lines 200
pm2 describe infinitystream-bridge | grep -i restart
free -m; df -h
```

- **Reinicia por memória (`max_memory_restart`):** reduza `MAX_ACTIVE_TORRENTS` (2) e `MAX_CONNS` (25)
  em `bridge/.env`, depois rode `pm2 reload ecosystem.config.js --update-env`.
- **Disco cheio:** reduza `MAX_CACHE_GB` ou apague `~/torrents-cache` com a bridge parada.
- **`node-datachannel` não encontrado:** `cd bridge && npm rebuild node-datachannel --foreground-scripts`.
  Sem ele, só o modo HTTP funciona.
- **PM2 não volta após reboot:** `pm2 save && sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu`.
- **Erro ao carregar `ecosystem.config.js`:** é necessário Node 22.12 ou mais recente (o arquivo é ESM). Confira com `node -v`.

## GitHub Actions falha

- `TMDB_API_KEY ausente` ou `401`: o secret está ausente ou errado (Settings → Secrets → Actions).
- `Permission denied` no push: habilite *Read and write permissions* em Settings → Actions → General.
- `[archive] busca falhou`: instabilidade do archive.org. A próxima execução tenta de novo; as outras fontes continuam.
- Execução lenta: reduza a variável `MAX_TITLES_PER_RUN`.

## A Oracle recuperou ou parou a VM

- Confira se o cron existe: `cat /etc/cron.d/infinitystream` e `grep infinitystream /var/log/syslog`.
- Se a VM foi parada: inicie pelo painel. Os dados no boot volume permanecem.
- Se foi apagada: crie outra, aponte o DNS para o novo IP e rode `deploy/oracle-setup.sh`.
- Prevenção definitiva: converta a conta para *Pay As You Go*. Os recursos Always Free seguem gratuitos e não são recuperados.

## "Seu navegador não suporta este formato"

O player é Direct Play: se o navegador não decodifica o codec ou contêiner, não há o que fazer no cliente.

- **H.265/HEVC:** Chrome/Edge atualizados no Windows (com a extensão HEVC) ou macOS; Safari no Apple.
  Firefox não suporta.
- **MKV:** Chrome/Edge tocam a maioria; o Safari não toca.
- **Áudio AC3/DTS/EAC3:** quase nenhum navegador decodifica, e o vídeo toca sem som.
  Prefira releases com AAC/Opus.
- Solução: escolha outra release (x264/MP4) na lista de fontes ou no seletor de qualidade do player.
  Releases HEVC já recebem penalidade no ranking quando o navegador não as suporta.

## Faixas de áudio (DUAL) não aparecem

O `video.audioTracks` só existe no Safari e no Chrome/Edge com a flag
`chrome://flags/#enable-experimental-web-platform-features`. Sem ela, o navegador toca a faixa padrão do arquivo.
