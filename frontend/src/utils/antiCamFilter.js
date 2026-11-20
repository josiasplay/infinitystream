// Filtro anti-CAM/TS/Telecine. Espelha scraper/release_filter.py (ANTI_CAM_RE).
// Segunda barreira: mesmo que algo passe pelo scraper, nunca aparece na UI.
export const ANTI_CAM_RE =
  /(?<![a-z0-9])(CAM|CAMRip|HDCAM|HDTS|TS|TELESYNC|TC|TELECINE|DVDSCR|SCREENER|VHSRip)(?![a-z0-9])/i

export function isCam (title = '') {
  // Normaliza separadores comuns de release ("Filme.2024.HDTS.x264")
  return ANTI_CAM_RE.test(String(title).replace(/[._-]/g, ' '))
}

export function filterCam (releases = []) {
  return releases.filter(r => !isCam(r.title) && !isCam(r.source))
}
