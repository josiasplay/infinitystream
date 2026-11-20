// PM2: mantém a bridge rodando 24/7 e reinicia se a memória passar do limite.
// Uso: pm2 start ecosystem.config.js && pm2 save && pm2 startup
//
// O pacote é "type": "module"; o PM2 carrega este arquivo com require(),
// que no Node >= 22.12 aceita ESM e expõe o export nomeado `apps`.
export const apps = [
  {
    name: 'infinitystream-bridge',
    script: './server.js',
    node_args: '--max-old-space-size=800',
    instances: 1, // WebTorrent mantém estado em memória: nada de cluster
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '850M', // VM tem 1 GB; deixa folga para o SO/Nginx
    restart_delay: 5000,
    kill_timeout: 10000,
    time: true,
    env: {
      NODE_ENV: 'production'
    }
  }
]

export default { apps }
