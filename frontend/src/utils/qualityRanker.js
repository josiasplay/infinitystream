// Escolha automática de release: qualidade que a rede aguenta + idioma preferido.
import { enrichRelease } from './releaseParser.js'
import { filterCam } from './antiCamFilter.js'

export const QUALITY_ORDER = ['480p', 'SD', '720p', '1080p', '4K']
export const QUALITY_RANK = { SD: 0, '480p': 1, '720p': 2, '1080p': 3, '4K': 4 }

// Banda mínima (Mbps) recomendada para cada qualidade
export const BANDWIDTH_FOR = { '4K': 25, '1080p': 8, '720p': 4, '480p': 1.5, SD: 0 }

/** Maior qualidade sustentável para a banda medida (em Mbps). */
export function maxQualityFor (mbps) {
  if (mbps == null) return '1080p' // sem medição: palpite conservador
  if (mbps > BANDWIDTH_FOR['4K']) return '4K'
  if (mbps > BANDWIDTH_FOR['1080p']) return '1080p'
  if (mbps > BANDWIDTH_FOR['720p']) return '720p'
  return '480p'
}

/** Ordem de idiomas: preferência do usuário → pt-BR → (anime: ja) → en. */
export function languageOrder (preferred = 'pt-BR', isAnime = false) {
  const base = isAnime ? ['pt-BR', 'ja', 'en'] : ['pt-BR', 'en', 'ja']
  return [preferred, ...base.filter(l => l !== preferred)]
}

/**
 * Ordena releases para exibição/seleção.
 * @param {object[]} releases
 * @param {{maxQuality?: string, language?: string, isAnime?: boolean, hevcSupported?: boolean}} opts
 */
export function rankReleases (releases, { maxQuality = '4K', language = 'pt-BR', isAnime = false, hevcSupported = true } = {}) {
  const langs = languageOrder(language, isAnime)
  const cap = QUALITY_RANK[maxQuality] ?? 4
  return filterCam(releases)
    .map(r => enrichRelease(r, { isAnime }))
    .map(r => {
      const q = QUALITY_RANK[r.quality] ?? 0
      let s = r.score ?? 50
      // Idioma pesa mais que tudo: dublado/dual vence legendado
      const li = langs.indexOf(r.language)
      s += li === -1 ? 0 : (langs.length - li) * 30
      if (r.dualAudio) s += 10
      // Acima da banda: forte penalidade (vai travar)
      if (q > cap) s -= 100 * (q - cap)
      else s += q * 8
      // HEVC sem suporte no navegador = tela preta
      if (r.codec === 'x265' && !hevcSupported) s -= 60
      return { ...r, _rank: s }
    })
    .sort((a, b) => b._rank - a._rank)
}

export function pickBestRelease (releases, opts) {
  return rankReleases(releases, opts)[0] || null
}
