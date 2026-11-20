// Leitor do catalog.json gerado pelo GitHub Actions (servido de /public).
import { filterCam } from '../utils/antiCamFilter.js'

let catalogPromise = null

export function loadCatalog () {
  if (!catalogPromise) {
    catalogPromise = fetch('/catalog.json', { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : { titles: {} }))
      .then(cat => {
        // Filtro duplo: remove qualquer CAM/TS que tenha escapado do scraper
        for (const [id, entry] of Object.entries(cat.titles || {})) {
          entry.releases = filterCam(entry.releases || [])
          if (!entry.releases.length) delete cat.titles[id]
        }
        return cat
      })
      .catch(err => {
        console.warn('[catalog] falha ao carregar', err)
        catalogPromise = null // permite tentar de novo
        return { titles: {} }
      })
  }
  return catalogPromise
}

export function catalogEntry (catalog, tmdbId) {
  return catalog?.titles?.[String(tmdbId)] || null
}

export function isAvailable (catalog, tmdbId) {
  return Boolean(catalogEntry(catalog, tmdbId))
}

/** Títulos do catálogo no formato de item TMDB (para reaproveitar MediaCard). */
export function catalogItems (catalog) {
  return Object.values(catalog?.titles || {})
    .sort((a, b) => (b.releases[0]?.added_at || '').localeCompare(a.releases[0]?.added_at || ''))
    .map(e => ({
      id: e.tmdb_id,
      media_type: e.type,
      title: e.title_pt_br,
      name: e.title_pt_br,
      poster_path: e.poster_path || null,
      release_date: e.year ? `${e.year}-01-01` : undefined
    }))
}
