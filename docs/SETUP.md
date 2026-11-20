# Setup completo (do zero)

Tempo estimado: 45 a 60 minutos.

## 1. Clonar o repositório

```bash
git clone https://github.com/<voce>/infinitystream.git
cd infinitystream
npm install          # dependências do frontend e da bridge (para testes locais)
npm test             # testes do parser, anti-CAM e ranking
```

Crie seu próprio repositório no GitHub (público é recomendado, pelos minutos ilimitados do Actions) e
faça push. Antes, confira com `git status` que **nada de `keys/`** aparece.

## 2. TMDB API

1. Crie a conta em <https://www.themoviedb.org/signup>.
2. Acesse <https://www.themoviedb.org/settings/api> → **Create** → **Developer**, para uso pessoal.
3. Copie a **API Key (v3 auth)** para `keys/tmdb_api_key.txt`.

## 3. Oracle Cloud: criar a VM

1. Conta em <https://www.oracle.com/cloud/free/>. Pede cartão para verificação, sem cobrança no Always Free.
2. **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **VM.Standard.E2.1.Micro** (Always Free: 1 OCPU, 1 GB)
   - Networking: VCN padrão, *Assign public IPv4 address*
   - SSH keys: **Generate a key pair** → baixe as duas chaves
3. Salve as chaves em `keys/oracle_ssh_key` (privada) e `keys/oracle_ssh_key.pub`.
   No Linux/macOS, rode `chmod 600 keys/oracle_ssh_key`.
4. Copie o **IP público** para `keys/oracle_host.txt`.
5. **Abrir portas na VCN:** Instance → Subnet → Security List → *Add Ingress Rules*:
   origem `0.0.0.0/0`, TCP, portas `80` e `443`.

## 4. Domínio para a bridge (obrigatório para HTTPS)

O site no Cloudflare Pages é HTTPS, e o navegador bloqueia chamadas HTTP (*mixed content*).
Por isso a bridge precisa de um certificado, e o certificado exige um domínio.

- **Domínio próprio:** crie um registro `A bridge.seudominio.com → IP da VM`. Se usar o DNS da
  Cloudflare, deixe o proxy **desligado** (nuvem cinza): WebSocket e streaming longo funcionam melhor direto.
- **Grátis:** [DuckDNS](https://www.duckdns.org) (`seunome.duckdns.org → IP`).

Grave o domínio em `keys/bridge_domain.txt` e seu e-mail em `keys/certbot_email.txt`.

## 5. Configurar a VM

```bash
# do seu PC: enviar o repositório (com keys/) para a VM
scp -i keys/oracle_ssh_key -r . ubuntu@$(cat keys/oracle_host.txt):~/infinitystream
# ou: clonar na VM e enviar só a pasta keys/
ssh -i keys/oracle_ssh_key ubuntu@$(cat keys/oracle_host.txt)

# na VM
cd ~/infinitystream
rm -f keys/oracle_ssh_key        # a chave privada NÃO deve ficar no servidor
sudo -E bash deploy/oracle-setup.sh
```

O script instala Node 24, PM2, Nginx, Certbot, fail2ban, ufw e 2 GB de swap; gera o `BRIDGE_TOKEN`
(se você não forneceu); configura o TLS, o firewall, o logrotate e o keep-alive. No final ele mostra o status.

Teste no seu PC:

```bash
curl https://bridge.seudominio.com/health
# {"status":"ok","uptime":12,"active_torrents":0,"memory_mb":88,...}
```

Copie o token para usar no site: `ssh ... cat ~/infinitystream/keys/bridge_token.txt`.

## 6. GitHub Actions

Siga [deploy/github-actions-setup.md](../deploy/github-actions-setup.md): crie o secret `TMDB_API_KEY`,
habilite *Read and write permissions* e rode **Atualizar catálogo** manualmente.

## 7. Cloudflare Pages

Siga [deploy/cloudflare-pages.md](../deploy/cloudflare-pages.md).
Build: `cd frontend && npm install && npm run build` · Saída: `frontend/dist` ·
Variáveis: `VITE_TMDB_API_KEY`, `VITE_ORACLE_BRIDGE_URL` e `NODE_VERSION=24`.

## 8. Primeiro acesso e teste

1. Abra `https://<projeto>.pages.dev`.
2. ⚙ **Configurações** → URL da bridge (se não estiver no build) e **token** → Salvar.
3. Em **Disponível para assistir**, abra *Sintel* (Creative Commons, já vem no catálogo inicial).
4. Clique em **Assistir**. Em alguns segundos, as métricas devem mostrar o modo (P2P/HTTP), a velocidade e os peers.
5. Para adicionar o seu conteúdo, edite `catalog-sources/magnets.json` e faça push.

## Desenvolvimento local

```bash
# bridge
cd bridge && BRIDGE_TOKEN=dev PORT=3000 npm start
# frontend (outro terminal)
cp frontend/.env.example frontend/.env.local   # VITE_ORACLE_BRIDGE_URL=http://localhost:3000
npm run dev                                    # http://localhost:5173 → Configurações → token "dev"
# varredor
pip install -r scraper/requirements.txt
python scraper/main.py                         # lê keys/tmdb_api_key.txt
```
