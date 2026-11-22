// Gerencia torrents ativos com cache LRU em disco.
// "Baixa, assiste e descarta": torrents ociosos são destruídos junto com os dados.
import fs from 'node:fs'
import WebTorrent from 'webtorrent'
import { config } from './config.js'

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ts)$/i
const SUB_EXT = /\.(vtt|srt)$/i

export class TorrentManager {
  constructor ({ trackerUrl }) {
    fs.mkdirSync(config.cacheDir, { recursive: true })
    this.trackerUrl = trackerUrl
    this.client = new WebTorrent({
      maxConns: config.maxConns,
      torrentPort: config.torrentPort,
      dhtPort: config.dhtPort,
      downloadLimit: config.downloadLimit > 0 ? config.downloadLimit * 1024 : -1,
      uploadLimit: config.uploadLimit > 0 ? config.uploadLimit * 1024 : -1
    })
    this.client.on('error', err => console.error('[webtorrent]', err.message))
    // infoHash -> { lastAccess, viewers, addedAt }
    this.meta = new Map()
    this.gcTimer = setInterval(() => this.gc().catch(e => console.error('[gc]', e)), config.gcIntervalMs)
  }

  get (infoHash) {
    return this.client.torrents.find(t => t.infoHash === infoHash) || null
  }

  touch (infoHash) {
    const m = this.meta.get(infoHash)
    if (m) m.lastAccess = Date.now()
  }

  viewerOpened (infoHash) {
    const m = this.meta.get(infoHash)
    if (m) { m.viewers++; m.lastAccess = Date.now() }
  }

  viewerClosed (infoHash) {
    const m = this.meta.get(infoHash)
    if (m) { m.viewers = Math.max(0, m.viewers - 1); m.lastAccess = Date.now() }
  }

  /** Adiciona (ou reaproveita) um torrent e espera os metadados. */
  async add (torrentId) {
    // Reaproveita se já existir (magnet com mesmo infoHash)
    const existingHash = /btih:([a-f0-9]{40})/i.exec(String(torrentId))?.[1]?.toLowerCase()
    if (existingHash) {
      const t = this.get(existingHash)
      if (t) { this.touch(t.infoHash); return this._ready(t) }
    }

    if (this.client.torrents.length >= config.maxActiveTorrents) {
      await this.evict({ force: true })
      if (this.client.torrents.length >= config.maxActiveTorrents) {
        const e = new Error('Limite de torrents ativos atingido; tente novamente em instantes')
        e.status = 503
        throw e
      }
    }

    // Metadados já vistos antes? Usa o .torrent salvo em disco: abre na hora, sem esperar peers/DHT
    if (existingHash) {
      const cached = await fs.promises.readFile(this._metaPath(existingHash)).catch(() => null)
      if (cached) torrentId = cached
      // Outro pedido (ex.: pré-aquecimento + Play) pode ter adicionado enquanto líamos o disco
      const t = this.get(existingHash.toLowerCase())
      if (t) { this.touch(t.infoHash); return this._ready(t) }
    }

    let torrent
    try {
      torrent = this.client.add(torrentId, {
        path: config.cacheDir,
        announce: [this.trackerUrl], // nosso tracker WSS: é por ele que o navegador nos encontra
        strategy: 'sequential' // prioriza peças em ordem (melhor para streaming)
      })
    } catch (err) {
      throw badTorrent(err)
    }
    torrent.on('error', err => console.error('[torrent]', err.message))
    // Pode já existir com o mesmo hash (torrent_url de algo já carregado)
    return this._ready(torrent)
  }

  _metaPath (infoHash) {
    return `${config.cacheDir}/.meta/${infoHash.toLowerCase()}.torrent`
  }

  /** Guarda o .torrent (só metadados, poucos KB) para os próximos Plays serem instantâneos. */
  _saveMeta (torrent) {
    const file = this._metaPath(torrent.infoHash)
    if (!torrent.torrentFile || fs.existsSync(file)) return
    fs.promises.mkdir(`${config.cacheDir}/.meta`, { recursive: true })
      .then(() => fs.promises.writeFile(file, torrent.torrentFile))
      .catch(err => console.warn('[meta]', err.message))
  }

  _ready (torrent) {
    const finish = () => {
      if (!this.meta.has(torrent.infoHash)) {
        this.meta.set(torrent.infoHash, { lastAccess: Date.now(), viewers: 0, addedAt: Date.now() })
      }
      this._saveMeta(torrent)
      this._selectMainFile(torrent)
      return torrent
    }
    if (torrent.ready || torrent.files?.length) return Promise.resolve(finish())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        torrent.destroy({ destroyStore: true })
        const e = new Error('Tempo esgotado buscando metadados (sem peers?)')
        e.status = 504
        reject(e)
      }, config.metadataTimeoutMs)
      torrent.once('ready', () => { clearTimeout(timer); resolve(finish()) })
      torrent.once('error', err => {
        clearTimeout(timer)
        if (!torrent.destroyed) torrent.destroy({ destroyStore: true })
        reject(badTorrent(err))
      })
    })
  }

  /** Baixa apenas o maior arquivo de vídeo (+ legendas). Ignora extras/amostras. */
  _selectMainFile (torrent) {
    const main = mainVideoFile(torrent)
    for (const f of torrent.files) {
      if (f === main || SUB_EXT.test(f.name)) f.select()
      else f.deselect()
    }
  }

  async remove (infoHash) {
    const t = this.get(infoHash)
    this.meta.delete(infoHash)
    if (!t) return false
    await new Promise(resolve => t.destroy({ destroyStore: true }, resolve))
    console.log(`[manager] removido ${infoHash}`)
    return true
  }

  diskUsage () {
    return this.client.torrents.reduce((sum, t) => sum + (t.downloaded || 0), 0)
  }

  /** Remove torrents inativos (sem viewers) do mais antigo para o mais novo. */
  async evict ({ force = false } = {}) {
    const candidates = [...this.meta.entries()]
      .filter(([, m]) => m.viewers === 0)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    for (const [hash] of candidates) {
      const overDisk = this.diskUsage() > config.maxCacheBytes
      const overCount = this.client.torrents.length >= config.maxActiveTorrents
      if (!overDisk && !(force && overCount)) break
      await this.remove(hash)
    }
  }

  async gc () {
    const now = Date.now()
    for (const [hash, m] of this.meta) {
      if (m.viewers === 0 && now - m.lastAccess > config.idleTtlMs) await this.remove(hash)
    }
    await this.evict()
    const mb = (this.diskUsage() / 1024 ** 2).toFixed(0)
    console.log(`[gc] ativos=${this.client.torrents.length} disco=${mb}MB rss=${(process.memoryUsage().rss / 1024 ** 2).toFixed(0)}MB`)
  }

  stats (torrent) {
    const m = this.meta.get(torrent.infoHash) || {}
    const main = mainVideoFile(torrent)
    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      progress: Number(torrent.progress.toFixed(4)),
      fileProgress: main ? Number(main.progress.toFixed(4)) : null,
      downloadSpeed: Math.round(torrent.downloadSpeed),
      uploadSpeed: Math.round(torrent.uploadSpeed),
      peers: torrent.numPeers,
      downloaded: torrent.downloaded,
      length: torrent.length,
      timeRemaining: Number.isFinite(torrent.timeRemaining) ? Math.round(torrent.timeRemaining) : null,
      viewers: m.viewers || 0
    }
  }

  async destroy () {
    clearInterval(this.gcTimer)
    await new Promise(resolve => this.client.destroy(resolve))
  }
}

/** Erro de parse (ex.: parse-torrent "reading 'info'") → 422 com mensagem clara, não 500. */
function badTorrent (err) {
  if (err.status) return err
  const e = new Error(`torrent inválido ou ilegível: ${err.message}`)
  e.status = /duplicate/i.test(err.message) ? 409 : 422
  return e
}

export function mainVideoFile (torrent) {
  const videos = (torrent.files || []).filter(f => VIDEO_EXT.test(f.name))
  return videos.sort((a, b) => b.length - a.length)[0] || null
}

export function describeFiles (torrent) {
  return torrent.files.map((f, index) => ({
    index,
    name: f.name,
    length: f.length,
    video: VIDEO_EXT.test(f.name),
    subtitle: SUB_EXT.test(f.name)
  }))
}
