// Cliente TMDB v3 com cache em localStorage (TTL 24h) para poupar a API.
const API_KEY = import.meta.env.VITE_TMDB_API_KEY
const BASE = 'https://api.themoviedb.org/3'
const TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'tmdb:'

export const hasTmdbKey = Boolean(API_KEY)

export function img (path, size = 'w342') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null
}

function readCache (key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { t, d } = JSON.parse(raw)
    return Date.now() - t < TTL_MS ? d : null
  } catch { return null }
}

function writeCache (key, data) {
  const value = JSON.stringify({ t: Date.now(), d: data })
  try {
    localStorage.setItem(key, value)
  } catch {
    // Quota estourada: apaga o cache do TMDB e tenta de novo uma vez
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k))
    try { localStorage.setItem(key, value) } catch { /* desiste silenciosamente */ }
  }
}

const inflight = new Map()

async function get (path, params = {}) {
  if (!API_KEY) throw new Error('VITE_TMDB_API_KEY não configurada')
  const qs = new URLSearchParams({ language: 'pt-BR', region: 'BR', ...params })
  const key = `${PREFIX}${path}?${qs}`
  const cached = readCache(key)
  if (cached) return cached
  if (inflight.has(key)) return inflight.get(key)

  qs.set('api_key', API_KEY)
  const p = fetch(`${BASE}${path}?${qs}`)
    .then(async res => {
      if (!res.ok) throw new Error(`TMDB ${res.status} em ${path}`)
      const data = await res.json()
      writeCache(key, data)
      return data
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const tag = type => item => ({ ...item, media_type: item.media_type || type })

export const tmdb = {
  trendingMovies: () => get('/trending/movie/week').then(d => d.results.map(tag('movie'))),
  nowPlaying: () => get('/movie/now_playing').then(d => d.results.map(tag('movie'))),
  upcoming: () => get('/movie/upcoming').then(d => d.results.map(tag('movie'))),
  popularTv: () => get('/tv/popular').then(d => d.results.map(tag('tv'))),
  anime: () => get('/discover/tv', { with_genres: 16, with_origin_country: 'JP', sort_by: 'popularity.desc' })
    .then(d => d.results.map(tag('tv'))),
  search: query => get('/search/multi', { query, include_adult: 'false' })
    .then(d => d.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv')),
  details: (type, id) => get(`/${type}/${id}`, {
    append_to_response: 'credits,videos',
    include_video_language: 'pt,en,null'
  }).then(tag(type))
}

/** Trailer preferindo pt-BR, depois inglês; só YouTube. */
export function pickTrailer (videos) {
  const list = (videos?.results || []).filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type))
  return list.find(v => v.iso_639_1 === 'pt') || list.find(v => v.iso_639_1 === 'en') || list[0] || null
}
