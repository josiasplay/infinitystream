// Parse de nomes de release (ex.: "Filme.2024.1080p.BluRay.DUAL.x265").
// Espelha scraper/release_filter.py — mantenha sincronizado.

const QUALITY = [
  ['4K', /\b(4k|2160p|uhd)\b/i],
  ['1080p', /\b1080[pi]\b/i],
  ['720p', /\b720p\b/i],
  ['480p', /\b(480p|sd|dvdrip|xvid)\b/i]
]
const CODEC = [
  ['x265', /\b(x265|h[ .]?265|hevc)\b/i],
  ['x264', /\b(x264|h[ .]?264|avc)\b/i],
  ['AV1', /\bav1\b/i]
]
const SOURCE = [
  ['REMUX', /\bremux\b/i],
  ['BluRay', /\b(blu-?ray|bdrip|brrip)\b/i],
  ['WEB-DL', /\bweb-?dl\b/i],
  ['WEBRip', /\bweb-?rip\b/i],
  ['HDTV', /\bhdtv\b/i]
]
const PT_BR = /(dublado|dual|\[brazilian\]|pt[-_. ]?br|nacional|portugu[eê]s)/i

const first = (list, text, fallback) => (list.find(([, rx]) => rx.test(text)) || [fallback])[0]

export function parseRelease (title = '', { isAnime = false } = {}) {
  const norm = String(title).replace(/[._]/g, ' ')
  let language = isAnime ? 'ja' : 'en'
  if (PT_BR.test(norm)) language = 'pt-BR'
  return {
    quality: first(QUALITY, norm, 'SD'),
    codec: first(CODEC, norm, 'Unknown'),
    source: first(SOURCE, norm, 'Unknown'),
    language,
    dualAudio: /\bdual\b/i.test(norm),
    year: Number((norm.match(/\b(19|20)\d{2}\b/) || [])[0]) || null
  }
}

/** Completa campos ausentes de uma release do catálogo usando o nome. */
export function enrichRelease (release, opts) {
  const parsed = parseRelease(release.title, opts)
  return {
    ...release,
    quality: release.quality || parsed.quality,
    codec: release.codec || parsed.codec,
    source: release.source || parsed.source,
    language: release.language || parsed.language,
    dualAudio: release.dual_audio ?? parsed.dualAudio
  }
}

export const LANGUAGE_LABEL = { 'pt-BR': 'Português (BR)', en: 'Inglês', ja: 'Japonês', es: 'Espanhol' }
