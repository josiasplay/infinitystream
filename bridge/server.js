// Bridge InfinityStream: conecta navegadores (WebRTC) à rede BitTorrent (TCP/UDP).
//
// Dois caminhos de reprodução, ambos Direct Play (sem transcodificação):
//  1. P2P WebRTC: o navegador entra no mesmo enxame via nosso tracker WSS (/tracker);
//     a bridge é um peer "híbrido" que baixa de peers TCP/UDP e repassa via WebRTC.
//  2. HTTP Range (/stream/:infoHash/:fileIndex): fallback quando WebRTC falha
//     (NAT simétrico, firewall corporativo). O <video> consome direto.
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { Server as TrackerServer } from 'bittorrent-tracker'
import { config } from './config.js'
import { TorrentManager, mainVideoFile, describeFiles } from './torrent-manager.js'

const startedAt = Date.now()
const trackerPublicUrl = config.publicUrl.replace(/^http/, 'ws') + '/tracker'

// ---------- tracker WebSocket embutido (sinalização WebRTC) ----------
const tracker = new TrackerServer({
  http: false,
  udp: false,
  stats: false,
  ws: { noServer: true },
  trustProxy: true,
  // Só aceita anúncios de torrents que a bridge está servindo
  filter: (infoHash, params, cb) => cb(manager.get(infoHash) ? null : new Error('torrent desconhecido'))
})
tracker.on('error', err => console.error('[tracker]', err.message))
tracker.on('warning', err => console.warn('[tracker]', err.message))

// A bridge anuncia no próprio tracker via loopback (o Nginx só é usado pelo navegador)
const manager = new TorrentManager({ trackerUrl: `ws://127.0.0.1:${config.port}/tracker` })

// ---------- app HTTP ----------
const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1) // atrás do Nginx

const PAGES_DEV = /^https:\/\/([a-z0-9-]+\.)*[a-z0-9-]+\.pages\.dev$/i
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
function originAllowed (origin) {
  if (!origin) return true // curl, <video> same-origin, health checks
  return PAGES_DEV.test(origin) || LOCALHOST.test(origin) || config.allowedOrigins.includes(origin)
}

app.use(cors({
  origin: (origin, cb) => cb(null, originAllowed(origin)),
  allowedHeaders: ['Content-Type', 'X-Bridge-Token', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  methods: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
  maxAge: 600
}))
app.use(express.json({ limit: '16kb' }))
app.use(rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitPerMin,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Range requests do player são muitas; não contam no limite
  skip: req => req.path.startsWith('/stream/')
}))

function tokenOk (provided) {
  if (!provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(config.bridgeToken)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// <video src> e WebSocket não enviam headers customizados → aceita ?token=
function auth (req, res, next) {
  if (tokenOk(req.get('X-Bridge-Token') || req.query.token)) return next()
  res.status(401).json({ error: 'token inválido' })
}

const isHash = h => /^[a-f0-9]{40}$/.test(h)

function validateTorrentId ({ magnet, torrent_url: torrentUrl }) {
  if (magnet) {
    if (!/^magnet:\?xt=urn:btih:[a-z0-9]{32,40}/i.test(magnet)) throw Object.assign(new Error('magnet inválido'), { status: 400 })
    return magnet
  }
  if (torrentUrl) {
    let u
    try { u = new URL(torrentUrl) } catch { throw Object.assign(new Error('torrent_url inválida'), { status: 400 }) }
    const hostOk = config.allowedTorrentHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
    if (u.protocol !== 'https:' || !hostOk) {
      throw Object.assign(new Error(`host não permitido: ${u.hostname} (ALLOWED_TORRENT_HOSTS)`), { status: 400 })
    }
    return u.toString()
  }
  throw Object.assign(new Error('envie magnet ou torrent_url'), { status: 400 })
}

// ---------- rotas ----------
app.get('/health', (req, res) => {
  const mem = process.memoryUsage()
  res.json({
    status: 'ok',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    active_torrents: manager.client.torrents.length,
    memory_mb: Math.round(mem.rss / 1024 ** 2),
    heap_mb: Math.round(mem.heapUsed / 1024 ** 2),
    cache_mb: Math.round(manager.diskUsage() / 1024 ** 2),
    download_speed: Math.round(manager.client.downloadSpeed),
    time: Date.now() // usado pelo frontend para medir latência
  })
})

// Teste de banda: devolve N bytes aleatórios (máx 4 MB) para o frontend medir Mbps.
// navigator.connection.downlink é limitado a 10 Mbps no Chrome, insuficiente para decidir 4K.
const SPEEDTEST_CHUNK = crypto.randomBytes(256 * 1024)
app.get('/speedtest', auth, (req, res) => {
  const bytes = Math.min(Math.max(Number(req.query.bytes) || 1024 ** 2, 64 * 1024), 4 * 1024 ** 2)
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes), 'Cache-Control': 'no-store' })
  let sent = 0
  while (sent < bytes) {
    const n = Math.min(SPEEDTEST_CHUNK.length, bytes - sent)
    res.write(n === SPEEDTEST_CHUNK.length ? SPEEDTEST_CHUNK : SPEEDTEST_CHUNK.subarray(0, n))
    sent += n
  }
  res.end()
})

app.post('/add', auth, async (req, res, next) => {
  try {
    const torrentId = validateTorrentId(req.body || {})
    const torrent = await manager.add(torrentId)
    const main = mainVideoFile(torrent)
    if (!main) return res.status(422).json({ error: 'nenhum arquivo de vídeo no torrent' })
    const mainIndex = torrent.files.indexOf(main)
    res.json({
      infoHash: torrent.infoHash,
      name: torrent.name,
      quality: req.body.quality || null,
      files: describeFiles(torrent),
      mainFileIndex: mainIndex,
      // Sinalização WebRTC: o navegador adiciona o magnet com este tracker
      ws_url: trackerPublicUrl,
      magnet: `magnet:?xt=urn:btih:${torrent.infoHash}&dn=${encodeURIComponent(torrent.name)}&tr=${encodeURIComponent(trackerPublicUrl)}`,
      // Fallback HTTP (token vai na query porque <video> não envia headers)
      stream_url: `${config.publicUrl}/stream/${torrent.infoHash}/${mainIndex}`
    })
  } catch (err) { next(err) }
})

app.get('/stats/:infoHash', auth, (req, res) => {
  const t = isHash(req.params.infoHash) && manager.get(req.params.infoHash)
  if (!t) return res.status(404).json({ error: 'torrent não encontrado' })
  manager.touch(t.infoHash)
  res.json(manager.stats(t))
})

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.vtt': 'text/vtt', '.srt': 'text/plain; charset=utf-8' }

// Streaming HTTP com suporte a Range (seek). Só lê do disco/rede as peças pedidas.
app.get('/stream/:infoHash/:fileIndex', auth, (req, res) => {
  const t = isHash(req.params.infoHash) && manager.get(req.params.infoHash)
  const file = t?.files?.[Number(req.params.fileIndex)]
  if (!file) return res.status(404).json({ error: 'arquivo não encontrado' })

  const total = file.length
  let start = 0
  let end = total - 1
  const range = req.get('Range')
  res.set({
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[path.extname(file.name).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  })
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!m) return res.status(416).set('Content-Range', `bytes */${total}`).end()
    if (m[1] === '') { start = Math.max(0, total - Number(m[2])) } else {
      start = Number(m[1])
      if (m[2] !== '') end = Math.min(Number(m[2]), total - 1)
    }
    if (start > end || start >= total) return res.status(416).set('Content-Range', `bytes */${total}`).end()
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${total}`)
  }
  res.set('Content-Length', String(end - start + 1))
  if (req.method === 'HEAD') return res.end()

  manager.viewerOpened(t.infoHash)
  const stream = file.createReadStream({ start, end })
  const done = () => manager.viewerClosed(t.infoHash)
  res.once('close', () => { stream.destroy(); done() })
  stream.on('error', err => { console.error('[stream]', err.message); res.destroy() })
  stream.pipe(res)
})

app.delete('/torrent/:infoHash', auth, async (req, res, next) => {
  try {
    if (!isHash(req.params.infoHash)) return res.status(400).json({ error: 'infoHash inválido' })
    const removed = await manager.remove(req.params.infoHash)
    res.status(removed ? 200 : 404).json({ removed })
  } catch (err) { next(err) }
})

app.use((req, res) => res.status(404).json({ error: 'rota não encontrada' }))
app.use((err, req, res, _next) => {
  const status = err.status || 500
  if (status >= 500) console.error('[erro]', err)
  res.status(status).json({ error: err.message || 'erro interno' })
})

// ---------- servidor + upgrade WebSocket ----------
const server = http.createServer(app)
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/tracker' && url.pathname !== '/stream') return socket.destroy()
  // Peers locais (a própria bridge) não precisam de token; o navegador precisa
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for']
  if (!isLoopback && !tokenOk(url.searchParams.get('token'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return socket.destroy()
  }
  if (!isLoopback && !originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    return socket.destroy()
  }
  tracker.ws.handleUpgrade(req, socket, head, ws => tracker.ws.emit('connection', ws, req))
})

server.listen(config.port, config.host, () => {
  console.log(`[bridge] ouvindo em http://${config.host}:${config.port}`)
  console.log(`[bridge] URL pública: ${config.publicUrl} | tracker: ${trackerPublicUrl}`)
  console.log(`[bridge] cache: ${config.cacheDir} (máx ${(config.maxCacheBytes / 1024 ** 3).toFixed(0)} GB)`)
})

// Encerramento limpo (PM2 envia SIGINT)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[bridge] ${sig} recebido, encerrando...`)
    server.close()
    tracker.close()
    await manager.destroy().catch(() => {})
    process.exit(0)
  })
}
