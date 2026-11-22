// Compatibilidade de mídia com o navegador, sem transcodificar vídeo.
//
// Problema: releases "DUAL 5.1" quase sempre trazem áudio AC-3/E-AC-3 (Dolby), que o
// Chrome/Firefox NÃO decodificam → o <video> recebe os bytes mas nunca começa a tocar.
// Solução: ffmpeg copia o vídeo como está (custo ~zero) e converte só o áudio para AAC
// estéreo, entregando MP4 fragmentado. Também escolhe a faixa no idioma preferido.
import { spawn } from 'node:child_process'
import { config } from './config.js'

const SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const LANG_CODES = {
  'pt-BR': ['pt', 'por', 'pob', 'pt-br', 'pt_br'],
  en: ['en', 'eng'],
  ja: ['ja', 'jpn']
}

const probeCache = new Map() // `${infoHash}/${fileIndex}` -> Promise<info|null>

function run (cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffprobe: tempo esgotado')) }, timeoutMs)
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim() || `ffprobe saiu com ${code}`)) })
  })
}

/** Lê codecs/duração do arquivo (só o cabeçalho, via /stream local). Resultado em cache. */
export function probe (localUrl, key) {
  if (!probeCache.has(key)) {
    const p = run(config.ffprobePath, [
      '-v', 'error', '-probesize', '5000000', '-analyzeduration', '0',
      '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,channels,disposition:stream_tags=language,title',
      '-of', 'json', localUrl
    ], config.probeTimeoutMs)
      .then(out => {
        const j = JSON.parse(out)
        const streams = j.streams || []
        const video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
        const audio = streams.filter(s => s.codec_type === 'audio').map((s, i) => ({
          i, // índice relativo entre as faixas de áudio (ffmpeg -map 0:a:i)
          codec: s.codec_name,
          channels: s.channels,
          lang: (s.tags?.language || '').toLowerCase(),
          title: s.tags?.title || ''
        }))
        return {
          container: j.format?.format_name || '',
          duration: Number(j.format?.duration) || null,
          video: video ? video.codec_name : null,
          audio
        }
      })
      .catch(err => { console.warn('[probe]', err.message); probeCache.delete(key); return null })
    probeCache.set(key, p)
    if (probeCache.size > 50) probeCache.delete(probeCache.keys().next().value)
  }
  return probeCache.get(key)
}

/**
 * Decide se precisa remux e qual faixa de áudio usar.
 * @param info resultado do probe
 * @param lang 'pt-BR' | 'en' | 'ja'
 * @param mkvOk navegador toca Matroska nativamente?
 */
export function playbackPlan (info, { lang = 'pt-BR', mkvOk = true } = {}) {
  if (!info || !info.audio.length) return { remux: false, audioIndex: 0, reason: 'sem informação' }
  const wanted = LANG_CODES[lang] || []
  const preferred = info.audio.find(a => wanted.includes(a.lang)) || info.audio[0]
  const reasons = []
  if (!SAFE_AUDIO.has(preferred.codec)) reasons.push(`áudio ${preferred.codec} não suportado pelo navegador`)
  if (preferred.i !== 0) reasons.push('faixa de áudio preferida não é a padrão')
  if (/matroska/.test(info.container) && !mkvOk) reasons.push('navegador não toca MKV')
  return { remux: reasons.length > 0, audioIndex: preferred.i, reason: reasons.join('; ') || 'direto' }
}

// ---------- remux sob demanda ----------
const active = new Set()

/** Responde com MP4 fragmentado: vídeo copiado + áudio AAC estéreo, começando em `start` segundos. */
export function remux (req, res, { localUrl, start = 0, audioIndex = 0, onOpen, onClose }) {
  // Usuário único trocando de posição: o pedido antigo vira lixo → encerra o mais velho
  while (active.size >= config.maxRemux) {
    const oldest = active.values().next().value
    oldest.kill('SIGKILL')
    active.delete(oldest)
  }

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', localUrl,
    '-map', '0:V:0', '-map', `0:a:${audioIndex}?`,
    '-c:v', 'copy',
    '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-sn', '-dn',
    '-avoid_negative_ts', 'make_zero',
    '-max_muxing_queue_size', '1024',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ]
  const ff = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  active.add(ff)
  onOpen?.()

  res.status(200).set({
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none'
  })
  ff.stdout.pipe(res)
  let stderr = ''
  ff.stderr.on('data', d => { if (stderr.length < 2000) stderr += d })

  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    active.delete(ff)
    onClose?.()
  }
  ff.on('error', err => { console.error('[remux]', err.message); finish(); res.destroy() })
  ff.on('close', code => {
    if (code && code !== 255 && stderr) console.warn('[remux] ffmpeg', code, stderr.trim().slice(0, 300))
    finish()
    res.end()
  })
  res.once('close', () => { if (!closed) ff.kill('SIGKILL') })
}
