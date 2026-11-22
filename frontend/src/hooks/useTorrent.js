// Hook de reprodução. Fluxo:
//  1. POST /add na bridge → ela entra no enxame (TCP/UDP + WebRTC) e devolve infoHash,
//     URL do tracker WSS e URL de streaming HTTP.
//  2. Modo P2P: WebTorrent no navegador adiciona o torrent anunciando no tracker da
//     bridge (+ trackers WSS públicos e webseeds do magnet). Os bytes chegam via
//     WebRTC e são servidos ao <video> pelo service worker (Direct Play).
//  3. Modo HTTP (fallback automático se o P2P não receber dados em 20s):
//     <video src="https://bridge/stream/...">, com Range/seek.
import { useEffect, useRef, useState } from 'react'
import { bridgeFetch } from '../api/bridge.js'

const P2P_TIMEOUT_MS = 20_000
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov)$/i

let clientPromise = null
async function getClient () {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('navegador sem service worker')
      // Bundle pré-compilado (com polyfills de Node) — carregado só quando necessário
      const { default: WebTorrent } = await import('webtorrent/dist/webtorrent.min.js')
      const client = new WebTorrent()
      const registration = await navigator.serviceWorker.ready
      client.createServer({ controller: registration })
      client.on('error', err => console.error('[webtorrent]', err))
      return client
    })().catch(err => { clientPromise = null; throw err })
  }
  return clientPromise
}

function srtToVtt (srt) {
  return 'WEBVTT\n\n' + srt.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

function subtitleLang (name) {
  const m = /[._-]([a-z]{2}(?:[-_][A-Za-z]{2})?)\.(srt|vtt)$/i.exec(name)
  return m ? m[1].replace('_', '-') : 'und'
}

export function useTorrent (release, { bridge, mode = 'auto', videoRef, language = 'pt-BR', mkv = true }) {
  const [status, setStatus] = useState('idle') // idle | adding | connecting | buffering | playing | error
  const [error, setError] = useState(null)
  const [activeMode, setActiveMode] = useState(null)
  const [stats, setStats] = useState(null)
  const [info, setInfo] = useState(null)
  const [subtitles, setSubtitles] = useState([]) // [{label, lang, src}]
  // Remux: o <video> começa sempre em 0; `offset` é a posição real do filme onde ele começou
  const [offset, setOffset] = useState(0)
  const remuxRef = useRef(null) // { url } quando a bridge está fazendo remux de áudio
  const cleanupRef = useRef([])

  /** Seek que funciona nos dois modos: Range nativo (/stream) ou novo pedido com ?t= (/remux). */
  function seekTo (seconds) {
    const video = videoRef.current
    if (!video) return
    const target = Math.max(0, seconds)
    if (!remuxRef.current) { video.currentTime = target; return }
    setOffset(target)
    setStatus('buffering')
    video.src = `${remuxRef.current.url}&t=${target.toFixed(1)}&token=${encodeURIComponent(bridge.token)}`
    video.play().catch(() => {})
  }

  useEffect(() => {
    if (!release || !videoRef.current) return
    const ctrl = new AbortController()
    let torrent = null
    const video = videoRef.current
    const cleanups = cleanupRef.current = []
    const later = fn => cleanups.push(fn)

    setStatus('adding'); setError(null); setStats(null); setSubtitles([]); setActiveMode(null); setOffset(0)
    remuxRef.current = null

    const fail = err => {
      if (ctrl.signal.aborted) return
      console.error('[player]', err)
      setError(err.message || String(err))
      setStatus('error')
    }

    async function loadSubtitles (added) {
      const subs = added.files.filter(f => f.subtitle)
      const out = []
      for (const f of subs.slice(0, 8)) {
        try {
          const res = await fetch(`${bridge.url}/stream/${added.infoHash}/${f.index}?token=${encodeURIComponent(bridge.token)}`, { signal: ctrl.signal })
          const text = await res.text()
          const vtt = /\.srt$/i.test(f.name) ? srtToVtt(text) : text
          const src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
          later(() => URL.revokeObjectURL(src))
          const lang = subtitleLang(f.name)
          out.push({ label: lang === 'und' ? f.name : lang, lang, src })
        } catch { /* legenda opcional */ }
      }
      // pt primeiro
      out.sort((a, b) => (b.lang.startsWith('pt') ? 1 : 0) - (a.lang.startsWith('pt') ? 1 : 0))
      if (!ctrl.signal.aborted) setSubtitles(out)
    }

    function startHttp (added) {
      if (ctrl.signal.aborted) return
      if (torrent) { torrent.destroy({ destroyStore: true }); torrent = null }
      setStatus('buffering')
      if (added.remux_url) {
        // Áudio Dolby (AC-3/E-AC-3) ou faixa pt não-padrão: bridge copia o vídeo e converte o áudio
        remuxRef.current = { url: added.remux_url }
        setActiveMode('remux')
        video.src = `${added.remux_url}&t=0&token=${encodeURIComponent(bridge.token)}`
      } else {
        setActiveMode('http')
        video.src = `${added.stream_url}?token=${encodeURIComponent(bridge.token)}`
      }
      video.play().catch(() => { /* autoplay bloqueado: usuário clica play */ })
      // Estatísticas vêm do enxame da bridge
      const poll = setInterval(async () => {
        try {
          const s = await bridgeFetch(bridge, `/stats/${added.infoHash}`, { signal: ctrl.signal, timeoutMs: 8000 })
          setStats({ downloadSpeed: s.downloadSpeed, peers: s.peers, progress: s.fileProgress ?? s.progress, source: 'bridge' })
        } catch { /* ignora */ }
      }, 3000)
      later(() => clearInterval(poll))
    }

    async function startP2P (added) {
      setActiveMode('p2p')
      setStatus('connecting')
      const client = await getClient()
      if (ctrl.signal.aborted) return
      const trackerUrl = `${added.ws_url}?token=${encodeURIComponent(bridge.token)}`
      // Reaproveita o magnet original (tem webseeds/trackers públicos); senão o da bridge
      const magnet = release.magnet || added.magnet
      const existing = await client.get(added.infoHash)
      if (existing) await new Promise(r => existing.destroy({ destroyStore: true }, r))
      torrent = client.add(magnet, { announce: [trackerUrl], destroyStoreOnDestroy: true })

      let gotData = false
      const fallbackTimer = setTimeout(() => {
        if (!gotData && mode === 'auto') {
          console.warn('[player] P2P sem dados em 20s → fallback HTTP')
          startHttp(added)
        } else if (!gotData) {
          fail(new Error('Nenhum peer WebRTC respondeu. Tente o modo HTTP nas Configurações.'))
        }
      }, P2P_TIMEOUT_MS)
      later(() => clearTimeout(fallbackTimer))

      torrent.on('download', () => { gotData = true })
      torrent.on('error', err => (mode === 'auto' ? startHttp(added) : fail(err)))
      const onReady = () => {
        if (ctrl.signal.aborted || !torrent) return
        const file = [...torrent.files].filter(f => VIDEO_EXT.test(f.name)).sort((a, b) => b.length - a.length)[0]
        if (!file) return fail(new Error('Torrent sem arquivo de vídeo compatível'))
        torrent.files.forEach(f => (f === file ? f.select() : f.deselect()))
        setStatus('buffering')
        file.streamTo(video)
        video.play().catch(() => {})
        const tick = setInterval(() => {
          if (!torrent) return
          setStats({ downloadSpeed: torrent.downloadSpeed, peers: torrent.numPeers, progress: file.progress, source: 'p2p' })
        }, 1000)
        later(() => clearInterval(tick))
      }
      torrent.ready ? onReady() : torrent.once('ready', onReady)

      // Mantém o torrent "vivo" no LRU da bridge enquanto assistimos
      const keepAlive = setInterval(() => {
        bridgeFetch(bridge, `/stats/${added.infoHash}`, { timeoutMs: 8000 }).catch(() => {})
      }, 60_000)
      later(() => clearInterval(keepAlive))
    }

    ;(async () => {
      try {
        // Preferimos .torrent HTTP quando é webseed (Internet Archive): metadados instantâneos
        const source = release.webseed && release.torrent_url
          ? { torrent_url: release.torrent_url }
          : release.magnet ? { magnet: release.magnet } : { torrent_url: release.torrent_url }
        const body = { ...source, quality: release.quality, lang: language, mkv }
        const added = await bridgeFetch(bridge, '/add', { method: 'POST', body, signal: ctrl.signal, timeoutMs: 60000 })
        if (ctrl.signal.aborted) return
        setInfo(added)
        loadSubtitles(added)
        const p2pPossible = 'serviceWorker' in navigator && typeof RTCPeerConnection !== 'undefined'
        // Padrão = HTTP direto da bridge: começa em <1s e não gasta CPU da VM com WebRTC.
        // P2P só quando escolhido nas Configurações e quando o arquivo toca sem remux.
        if (mode !== 'p2p' || !p2pPossible || added.remux) startHttp(added)
        else await startP2P(added).catch(err => (mode === 'auto' ? startHttp(added) : fail(err)))
      } catch (err) { fail(err) }
    })()

    const onPlaying = () => setStatus('playing')
    const onWaiting = () => setStatus(s => (s === 'error' ? s : 'buffering'))
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)

    return () => {
      ctrl.abort()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      cleanups.forEach(fn => { try { fn() } catch { /* ignora */ } })
      if (torrent) torrent.destroy({ destroyStore: true }) // "assiste e descarta"
      video.removeAttribute('src')
      video.load()
    }
  }, [release, bridge.url, bridge.token, mode, language]) // eslint-disable-line react-hooks/exhaustive-deps

  return { status, error, activeMode, stats, info, subtitles, offset, seekTo, mediaDuration: info?.duration || null }
}
