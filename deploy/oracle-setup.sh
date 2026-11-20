#!/usr/bin/env bash
# =============================================================================
# InfinityStream — configuração da VM Oracle Cloud Free Tier (Ubuntu 22.04/24.04)
# Idempotente: pode ser executado várias vezes com segurança.
#
# Uso (na VM, dentro do repositório clonado):
#   sudo -E bash deploy/oracle-setup.sh
#
# Variáveis (env) ou arquivos em keys/:
#   BRIDGE_DOMAIN   keys/bridge_domain.txt   (obrigatório p/ HTTPS) ex: bridge.seudominio.com
#   CERTBOT_EMAIL   keys/certbot_email.txt   (obrigatório p/ HTTPS)
#   BRIDGE_TOKEN    keys/bridge_token.txt    (gerado automaticamente se ausente)
#   ALLOWED_ORIGINS keys/allowed_origins.txt (opcional)
#   REPO_URL        (opcional) clona o repo em /opt/infinitystream se o script
#                   não estiver rodando de dentro de um clone
#   MAX_CACHE_GB    (padrão 30)   SWAP_GB (padrão 2)   APP_USER (padrão ubuntu)
# =============================================================================
set -euo pipefail

log()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[aviso] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[erro] %s\033[0m\n' "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "Rode com sudo: sudo -E bash $0"

APP_USER="${APP_USER:-${SUDO_USER:-ubuntu}}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" ]] || die "Usuário $APP_USER não existe"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../bridge/server.js" ]]; then
  APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  APP_DIR="/opt/infinitystream"
fi
KEYS_DIR="$APP_DIR/keys"

read_key() { # read_key VAR arquivo
  local var="$1" file="$2"
  if [[ -n "${!var:-}" ]]; then printf '%s' "${!var}"; return; fi
  if [[ -f "$KEYS_DIR/$file" ]]; then tr -d '\r\n' < "$KEYS_DIR/$file"; fi
}

# --------------------------------------------------------------------- sistema
log "Atualizando o sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confold"
apt-get install -y curl git ca-certificates gnupg openssl nginx certbot python3-certbot-nginx \
  fail2ban ufw iptables-persistent jq build-essential python3

# ------------------------------------------------------------------------ swap
# 1 GB de RAM é pouco para Node + WebTorrent; swap evita o OOM killer.
SWAP_GB="${SWAP_GB:-2}"
if ! swapon --show | grep -q '/swapfile'; then
  log "Criando swap de ${SWAP_GB} GB"
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024))
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=20' > /etc/sysctl.d/99-infinitystream.conf
  sysctl -p /etc/sysctl.d/99-infinitystream.conf >/dev/null
fi

# ---------------------------------------------------------------------- Node.js
# Node 20 saiu de suporte em abr/2026 → usamos o LTS atual (24).
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  log "Instalando Node.js 24 LTS"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v) / npm $(npm -v)"
command -v pm2 >/dev/null || npm install -g pm2@latest

# ------------------------------------------------------------------ repositório
if [[ ! -f "$APP_DIR/bridge/server.js" ]]; then
  [[ -n "${REPO_URL:-}" ]] || die "Rode de dentro do repo clonado ou defina REPO_URL"
  log "Clonando $REPO_URL em $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$KEYS_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------- chaves
BRIDGE_DOMAIN="$(read_key BRIDGE_DOMAIN bridge_domain.txt)"
CERTBOT_EMAIL="$(read_key CERTBOT_EMAIL certbot_email.txt)"
BRIDGE_TOKEN="$(read_key BRIDGE_TOKEN bridge_token.txt)"
ALLOWED_ORIGINS="$(read_key ALLOWED_ORIGINS allowed_origins.txt)"
MAX_CACHE_GB="${MAX_CACHE_GB:-30}"

if [[ -z "$BRIDGE_TOKEN" ]]; then
  BRIDGE_TOKEN="$(openssl rand -hex 32)"
  printf '%s' "$BRIDGE_TOKEN" > "$KEYS_DIR/bridge_token.txt"
  warn "BRIDGE_TOKEN gerado e salvo em $KEYS_DIR/bridge_token.txt"
fi
chmod 700 "$KEYS_DIR"
find "$KEYS_DIR" -type f -exec chmod 600 {} +
chown -R "$APP_USER:$APP_USER" "$KEYS_DIR"

# Chave pública SSH do usuário (se fornecida em keys/) → authorized_keys
if [[ -f "$KEYS_DIR/oracle_ssh_key.pub" ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
  touch "$APP_HOME/.ssh/authorized_keys"
  grep -qxF "$(cat "$KEYS_DIR/oracle_ssh_key.pub")" "$APP_HOME/.ssh/authorized_keys" \
    || cat "$KEYS_DIR/oracle_ssh_key.pub" >> "$APP_HOME/.ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "$APP_HOME/.ssh/authorized_keys"
  chmod 600 "$APP_HOME/.ssh/authorized_keys"
fi
# A chave PRIVADA nunca deve ficar no servidor
if [[ -f "$KEYS_DIR/oracle_ssh_key" ]]; then
  warn "keys/oracle_ssh_key (privada) está na VM — apague-a: ela só deve existir no seu PC."
fi

if [[ -n "$BRIDGE_DOMAIN" ]]; then
  PUBLIC_URL="https://$BRIDGE_DOMAIN"
else
  PUBLIC_URL="http://$(curl -fsS -4 -m 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
fi

log "Gravando bridge/.env"
cat > "$APP_DIR/bridge/.env" <<EOF
BRIDGE_TOKEN=$BRIDGE_TOKEN
PUBLIC_URL=$PUBLIC_URL
ALLOWED_ORIGINS=$ALLOWED_ORIGINS
PORT=3000
HOST=127.0.0.1
CACHE_DIR=$APP_HOME/torrents-cache
MAX_CACHE_GB=$MAX_CACHE_GB
MAX_ACTIVE_TORRENTS=4
MAX_CONNS=40
EOF
chmod 600 "$APP_DIR/bridge/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/bridge/.env"

# ------------------------------------------------------------- dependências npm
log "Instalando dependências da bridge"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/bridge' && npm install --omit=dev --workspaces=false --no-audit --no-fund"
# npm >= 11 pode bloquear scripts nativos; garante os binários de WebRTC/uTP
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/bridge' && npm rebuild node-datachannel utp-native --workspaces=false --foreground-scripts" \
  || warn "rebuild nativo falhou; WebRTC pode não funcionar (o modo HTTP continua ok)"

# ------------------------------------------------------------------------ Nginx
log "Configurando Nginx"
SERVER_NAME="${BRIDGE_DOMAIN:-_}"
cat > /etc/nginx/sites-available/infinitystream <<EOF
# Gerado por deploy/oracle-setup.sh — não edite à mão (é sobrescrito)
limit_req_zone \$binary_remote_addr zone=bridge_api:10m rate=10r/s;

map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    client_max_body_size 16k;
    server_tokens off;

    # Tracker WebSocket (sinalização WebRTC)
    location /tracker {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
    }

    # Streaming HTTP com Range: sem buffer para não estourar RAM/disco
    location /stream/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location / {
        limit_req zone=bridge_api burst=40 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/infinitystream /etc/nginx/sites-enabled/infinitystream
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# --------------------------------------------------------------------- firewall
log "Configurando firewall (22, 80, 443)"
# Imagens Ubuntu da Oracle trazem iptables com REJECT geral: liberamos 80/443 antes dele
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null   # SEMPRE antes do enable, para não perder o SSH
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw deny 3000 >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed 's/^/   /'
warn "Na Oracle, libere também 80/443 na Security List da VCN (painel web)."

# --------------------------------------------------------------------- fail2ban
log "Configurando fail2ban"
cat > /etc/fail2ban/jail.d/infinitystream.local <<'EOF'
[sshd]
enabled  = true
maxretry = 5
bantime  = 1h

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 20
findtime = 1m
bantime  = 30m
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

# ------------------------------------------------------------------ HTTPS (TLS)
if [[ -n "$BRIDGE_DOMAIN" && -n "$CERTBOT_EMAIL" ]]; then
  log "Obtendo certificado Let's Encrypt para $BRIDGE_DOMAIN"
  if certbot --nginx -d "$BRIDGE_DOMAIN" -m "$CERTBOT_EMAIL" --agree-tos --non-interactive --redirect --keep-until-expiring; then
    systemctl enable --now certbot.timer 2>/dev/null || true
  else
    warn "Certbot falhou. Confira se o DNS de $BRIDGE_DOMAIN aponta para esta VM e se a porta 80 está aberta na VCN."
  fi
else
  warn "BRIDGE_DOMAIN/CERTBOT_EMAIL ausentes: bridge só em HTTP. O site no Cloudflare Pages (HTTPS) NÃO consegue chamar HTTP (mixed content)."
fi

# -------------------------------------------------------------------------- PM2
log "Iniciando a bridge com PM2"
sudo -u "$APP_USER" -H bash -c "
  set -e
  cd '$APP_DIR/bridge'
  if pm2 describe infinitystream-bridge >/dev/null 2>&1; then
    pm2 reload ecosystem.config.js --update-env
  else
    pm2 start ecosystem.config.js
  fi
  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:max_size 10M >/dev/null
  pm2 set pm2-logrotate:retain 5 >/dev/null
  pm2 set pm2-logrotate:compress true >/dev/null
  pm2 save
"
pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true

# ------------------------------------------------------------------- keep-alive
# A Oracle pode recuperar instâncias Always Free "ociosas" (CPU no percentil 95
# < 20% por 7 dias). Este job gera ~5 min/hora de carga leve (nice 19, não
# atrapalha o streaming) e confere a saúde da bridge a cada 5 minutos.
log "Configurando keep-alive e watchdog"
cat > /usr/local/bin/infinitystream-keepalive <<EOF
#!/usr/bin/env bash
# Watchdog: reinicia a bridge se /health não responder
if ! curl -fsS -m 10 http://127.0.0.1:3000/health >/dev/null; then
  logger -t infinitystream "health falhou, reiniciando bridge"
  sudo -u $APP_USER -H pm2 restart infinitystream-bridge >/dev/null 2>&1
fi
EOF
cat > /usr/local/bin/infinitystream-cpuburn <<'EOF'
#!/usr/bin/env bash
# ~5 minutos de CPU em prioridade mínima (duty cycle ~40%)
end=$((SECONDS + 300))
while (( SECONDS < end )); do
  timeout 0.4 nice -n 19 sh -c 'while :; do :; done' || true
  sleep 0.6
done
EOF
chmod +x /usr/local/bin/infinitystream-keepalive /usr/local/bin/infinitystream-cpuburn
cat > /etc/cron.d/infinitystream <<EOF
# InfinityStream: watchdog a cada 5 min, curl externo a cada 6h, carga leve 1x/hora
*/5 * * * * root /usr/local/bin/infinitystream-keepalive
0 */6 * * * root curl -fsS -m 10 $PUBLIC_URL/health >/dev/null 2>&1
17 * * * *  root /usr/local/bin/infinitystream-cpuburn
EOF
chmod 644 /etc/cron.d/infinitystream

# ---------------------------------------------------------------------- resumo
sleep 3
HEALTH="$(curl -fsS -m 5 http://127.0.0.1:3000/health || echo '{"status":"FALHOU"}')"
cat <<EOF

=====================================================================
 InfinityStream bridge configurada
=====================================================================
 URL pública ........ $PUBLIC_URL
 Health local ....... $HEALTH
 Token .............. em $KEYS_DIR/bridge_token.txt e bridge/.env
                      (no site: ⚙ Configurações → Token da bridge)

 Comandos úteis:
   pm2 status                       # estado do processo
   pm2 logs infinitystream-bridge   # logs em tempo real
   pm2 restart infinitystream-bridge
   curl $PUBLIC_URL/health
   sudo ufw status && sudo fail2ban-client status
   sudo certbot renew --dry-run     # testar renovação do TLS

 Atualizar o código:
   cd $APP_DIR && git pull && sudo -E bash deploy/oracle-setup.sh
=====================================================================
EOF
