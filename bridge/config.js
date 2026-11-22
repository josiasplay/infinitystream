// Configuração da bridge: variáveis de ambiente primeiro, depois keys/*.txt
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true })

const KEYS_DIR = process.env.KEYS_DIR || path.join(__dirname, '..', 'keys')

function readKey (envName, file) {
  if (process.env[envName]) return process.env[envName].trim()
  if (file) {
    try {
      const v = fs.readFileSync(path.join(KEYS_DIR, file), 'utf8').trim()
      if (v) return v
    } catch { /* arquivo ausente: segue */ }
  }
  return undefined
}

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d)
const domain = readKey('BRIDGE_DOMAIN', 'bridge_domain.txt')
const port = num(process.env.PORT, 3000)

export const config = {
  port,
  host: process.env.HOST || '127.0.0.1', // só localhost: o Nginx fica na frente
  bridgeToken: readKey('BRIDGE_TOKEN', 'bridge_token.txt'),
  publicUrl: (readKey('PUBLIC_URL') || (domain ? `https://${domain}` : `http://localhost:${port}`)).replace(/\/$/, ''),
  allowedOrigins: (readKey('ALLOWED_ORIGINS', 'allowed_origins.txt') || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Hosts permitidos para baixar .torrent via HTTP (evita SSRF)
  allowedTorrentHosts: (process.env.ALLOWED_TORRENT_HOSTS || 'archive.org,webtorrent.io')
    .split(',').map(s => s.trim()).filter(Boolean),
  cacheDir: process.env.CACHE_DIR || path.join(os.homedir(), 'torrents-cache'),
  maxCacheBytes: num(process.env.MAX_CACHE_GB, 30) * 1024 ** 3,
  maxActiveTorrents: num(process.env.MAX_ACTIVE_TORRENTS, 4),
  idleTtlMs: num(process.env.IDLE_TTL_MIN, 30) * 60_000,
  gcIntervalMs: num(process.env.GC_INTERVAL_MIN, 5) * 60_000,
  metadataTimeoutMs: num(process.env.METADATA_TIMEOUT_S, 45) * 1000,
  maxConns: num(process.env.MAX_CONNS, 40), // conexões por torrent (RAM!)
  downloadLimit: num(process.env.DOWNLOAD_LIMIT_KBPS, -1), // -1 = sem limite
  uploadLimit: num(process.env.UPLOAD_LIMIT_KBPS, -1),
  rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 120),
  // Remux (vídeo copiado + áudio → AAC) para áudio Dolby que o navegador não toca
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  probeTimeoutMs: num(process.env.PROBE_TIMEOUT_S, 20) * 1000,
  maxRemux: num(process.env.MAX_REMUX, 2) // processos ffmpeg simultâneos (CPU da VM)
}

if (!config.bridgeToken) {
  console.error('[config] BRIDGE_TOKEN ausente (env ou keys/bridge_token.txt). Abortando.')
  process.exit(1)
}
