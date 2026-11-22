import { useEffect, useMemo, useRef, useState } from 'react'
import { useTorrent } from '../hooks/useTorrent.js'
import { codecSupport, pingBridge } from '../hooks/useNetworkQuality.js'
import { usePreferences } from '../hooks/usePreferences.js'
import { bridgeConfig } from '../api/bridge.js'
import { LANGUAGE_LABEL } from '../utils/releaseParser.js'
import ConnectionStats from './ConnectionStats.jsx'

const UNSUPPORTED_MSG = 'Seu navegador não suporta este formato. Use Chrome/Edge atualizado ou instale o app.'

function fmtTime (s) {
  if (!Number.isFinite(s)) return '--:--'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const STATUS_LABEL = {
  adding: 'Pedindo o torrent à bridge…',
  connecting: 'Conectando aos peers (WebRTC)…',
  buffering: 'Carregando…'
}

/**
 * Player Direct Play: <video> nativo, sem HLS/transcodificação.
 * Props: release (selecionada), releases (alternativas p/ troca de qualidade), onSelectRelease, onClose
 */
export default function TorrentPlayer ({ release, releases = [], onSelectRelease, onClose, title }) {
  const [prefs] = usePreferences()
  const bridge = bridgeConfig(prefs)
  const containerRef = useRef(null)
  const videoRef = useRef(null)
  const codecs = useMemo(() => codecSupport(), [])
  const { status, error, activeMode, stats, subtitles, offset, seekTo, mediaDuration } =
    useTorrent(release, { bridge, mode: prefs.mode, videoRef, language: prefs.language, mkv: codecs.mkv })
  const isRemux = activeMode === 'remux'
  const seekTimer = useRef(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(NaN)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [bufferSec, setBufferSec] = useState(null)
  const [latencyMs, setLatencyMs] = useState(null)
  const [subIndex, setSubIndex] = useState(-1)
  const [audioTracks, setAudioTracks] = useState([])
  const [mediaError, setMediaError] = useState(null)

  const formatWarning = useMemo(() => {
    if (release?.codec === 'x265' && !codecs.hevc) return UNSUPPORTED_MSG + ' (vídeo H.265/HEVC)'
    if (/\.mkv\b|mkv/i.test(release?.title || '') && !codecs.mkv && !isRemux) return UNSUPPORTED_MSG + ' (contêiner MKV)'
    return null
  }, [release, codecs, isRemux])

  // Posição/duração REAIS do filme (no remux o <video> recomeça em 0 a cada seek)
  const realTime = offset + time
  const realDuration = mediaDuration || duration

  /** Pula para `target` (segundos do filme). No remux, usa o buffer se já tiver baixado. */
  function jump (target, { debounce = false } = {}) {
    const v = videoRef.current
    if (!v) return
    const total = Number.isFinite(realDuration) ? realDuration : Infinity
    target = Math.max(0, Math.min(target, total - 1))
    if (!isRemux) { v.currentTime = target; return }
    const local = target - offset
    for (let i = 0; i < v.buffered.length; i++) {
      if (local >= v.buffered.start(i) && local <= v.buffered.end(i)) { v.currentTime = local; return }
    }
    clearTimeout(seekTimer.current)
    if (debounce) {
      setTime(target - offset) // barra acompanha o arraste
      seekTimer.current = setTimeout(() => seekTo(target), 450)
    } else {
      seekTo(target)
    }
  }

  // Legendas externas (.srt/.vtt) acompanham o deslocamento do remux
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    for (const track of v.textTracks) {
      for (const cue of track.cues || []) {
        if (cue._s === undefined) { cue._s = cue.startTime; cue._e = cue.endTime }
        cue.startTime = cue._s - offset
        cue.endTime = cue._e - offset
      }
    }
  }, [offset, subIndex, subtitles])

  // Eventos do <video>
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      setTime(v.currentTime)
      // Buffer à frente da posição atual
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
          setBufferSec(v.buffered.end(i) - v.currentTime)
          return
        }
      }
      setBufferSec(0)
    }
    const onMeta = () => {
      setDuration(v.duration)
      setMediaError(null)
      // Faixas de áudio (DUAL): Safari e Chrome com flag expõem audioTracks
      if (v.audioTracks) {
        const list = [...v.audioTracks].map((t, i) => ({ i, label: t.label || LANGUAGE_LABEL[t.language] || t.language || `Faixa ${i + 1}`, language: t.language, enabled: t.enabled }))
        setAudioTracks(list)
        // Seleciona automaticamente a faixa pt
        const pt = list.find(t => /^pt|por/i.test(t.language || ''))
        if (pt && prefs.language === 'pt-BR') [...v.audioTracks].forEach((t, i) => { t.enabled = i === pt.i })
      }
    }
    const onError = () => {
      const code = v.error?.code
      if (code === 4 || code === 3) setMediaError(UNSUPPORTED_MSG)
    }
    const handlers = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      timeupdate: onTime,
      progress: onTime,
      loadedmetadata: onMeta,
      volumechange: () => { setVolume(v.volume); setMuted(v.muted) },
      error: onError
    }
    Object.entries(handlers).forEach(([e, h]) => v.addEventListener(e, h))
    return () => Object.entries(handlers).forEach(([e, h]) => v.removeEventListener(e, h))
  }, [prefs.language])

  // Ping periódico até a bridge
  useEffect(() => {
    if (!bridge.url) return
    let alive = true
    const run = () => pingBridge(bridge.url).then(ms => alive && setLatencyMs(ms)).catch(() => alive && setLatencyMs(null))
    run()
    const t = setInterval(run, 10_000)
    return () => { alive = false; clearInterval(t) }
  }, [bridge.url])

  // Legendas: ativa a pt por padrão quando chegam
  useEffect(() => {
    if (subtitles.length && prefs.subtitles && subIndex === -1) {
      const pt = subtitles.findIndex(s => s.lang.startsWith('pt'))
      if (pt >= 0 || prefs.language !== 'pt-BR' || release?.language !== 'pt-BR') setSubIndex(Math.max(pt, 0))
    }
  }, [subtitles]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    ;[...v.textTracks].forEach((t, i) => { t.mode = i === subIndex ? 'showing' : 'disabled' })
  }, [subIndex, subtitles])

  // Atalhos de teclado (refs: o listener é registrado uma vez, mas precisa do jump/offset atuais)
  const jumpRef = useRef(jump)
  const offsetRef = useRef(offset)
  jumpRef.current = jump
  offsetRef.current = offset
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      const v = videoRef.current
      if (!v) return
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause() }
      if (e.key === 'ArrowRight') jumpRef.current(offsetRef.current + v.currentTime + 10)
      if (e.key === 'ArrowLeft') jumpRef.current(offsetRef.current + v.currentTime - 10)
      if (e.key === 'f') toggleFullscreen()
      if (e.key === 'm') v.muted = !v.muted
      if (e.key === 'Escape' && !document.fullscreenElement) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleFullscreen () {
    const el = containerRef.current
    if (!el) return
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.()
  }

  const v = videoRef.current
  const shownError = mediaError || error
  const busy = !shownError && STATUS_LABEL[status]

  return (
    <section className='space-y-3' aria-label={`Player: ${title}`}>
      <div ref={containerRef} className='group relative overflow-hidden rounded-xl bg-black ring-1 ring-zinc-800'>
        <video
          ref={videoRef}
          className='aspect-video w-full bg-black'
          playsInline
          crossOrigin='anonymous'
          preload='auto'
          onClick={() => (v?.paused ? v.play() : v?.pause())}
        >
          {subtitles.map((s, i) => <track key={s.src} kind='subtitles' src={s.src} srcLang={s.lang} label={s.label} default={i === subIndex} />)}
        </video>

        {(busy || shownError || formatWarning) && (
          <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-6 text-center'>
            {busy && <div className='h-10 w-10 animate-spin rounded-full border-4 border-zinc-600 border-t-accent' aria-hidden />}
            {busy && <p className='text-sm text-zinc-200'>{busy}</p>}
            {shownError && <p className='max-w-lg rounded-md bg-red-950/80 px-4 py-2 text-sm text-red-200'>{shownError}</p>}
            {formatWarning && !shownError && status !== 'playing' && (
              <p className='max-w-lg rounded-md bg-amber-950/80 px-4 py-2 text-sm text-amber-200'>{formatWarning}</p>
            )}
          </div>
        )}

        {/* Barra de controles */}
        <div className='absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100'>
          <input
            type='range'
            className='seek w-full'
            min={0}
            max={Number.isFinite(realDuration) ? realDuration : 0}
            step={1}
            value={realTime}
            onChange={e => jump(Number(e.target.value), { debounce: true })}
            aria-label='Posição'
          />
          <div className='flex flex-wrap items-center gap-3 text-sm'>
            <button type='button' onClick={() => (v?.paused ? v.play() : v?.pause())} className='rounded px-2 py-1 hover:bg-white/10' aria-label={playing ? 'Pausar' : 'Reproduzir'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type='button' onClick={() => jump(realTime - 10)} className='rounded px-2 py-1 hover:bg-white/10' aria-label='Voltar 10 segundos'>−10s</button>
            <button type='button' onClick={() => jump(realTime + 10)} className='rounded px-2 py-1 hover:bg-white/10' aria-label='Avançar 10 segundos'>+10s</button>
            <span className='font-mono text-xs text-zinc-300'>{fmtTime(realTime)} / {fmtTime(realDuration)}</span>

            <button type='button' onClick={() => { if (v) v.muted = !v.muted }} className='rounded px-2 py-1 hover:bg-white/10' aria-label={muted ? 'Ativar som' : 'Silenciar'}>
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input type='range' min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => { if (v) { v.volume = Number(e.target.value); v.muted = false } }} className='seek w-20' aria-label='Volume' />

            <div className='ml-auto flex flex-wrap items-center gap-2'>
              {audioTracks.length > 1 && (
                <select
                  aria-label='Faixa de áudio'
                  className='rounded bg-zinc-900/90 px-2 py-1 text-xs'
                  defaultValue={audioTracks.find(t => t.enabled)?.i}
                  onChange={e => [...v.audioTracks].forEach((t, i) => { t.enabled = i === Number(e.target.value) })}
                >
                  {audioTracks.map(t => <option key={t.i} value={t.i}>🔈 {t.label}</option>)}
                </select>
              )}
              <select aria-label='Legendas' className='rounded bg-zinc-900/90 px-2 py-1 text-xs' value={subIndex} onChange={e => setSubIndex(Number(e.target.value))}>
                <option value={-1}>Legendas: off</option>
                {subtitles.map((s, i) => <option key={s.src} value={i}>CC {s.label}</option>)}
              </select>
              {releases.length > 1 && (
                <select
                  aria-label='Trocar qualidade'
                  className='rounded bg-zinc-900/90 px-2 py-1 text-xs'
                  value={releases.findIndex(r => (r.magnet || r.torrent_url) === (release.magnet || release.torrent_url))}
                  onChange={e => onSelectRelease?.(releases[Number(e.target.value)])}
                >
                  {releases.map((r, i) => (
                    <option key={r.magnet || r.torrent_url || i} value={i}>
                      {r.quality} · {LANGUAGE_LABEL[r.language] || r.language} · {r.source}
                    </option>
                  ))}
                </select>
              )}
              <button type='button' onClick={toggleFullscreen} className='rounded px-2 py-1 hover:bg-white/10' aria-label='Tela cheia'>⛶</button>
            </div>
          </div>
        </div>
      </div>

      <ConnectionStats stats={stats} latencyMs={latencyMs} bufferSec={bufferSec} mode={activeMode} />
      {release?.license && <p className='text-xs text-zinc-500'>Licença: {release.license}</p>}
    </section>
  )
}
