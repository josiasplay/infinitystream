// Testes rápidos: node --test src/utils/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRelease } from './releaseParser.js'
import { isCam, filterCam } from './antiCamFilter.js'
import { maxQualityFor, pickBestRelease } from './qualityRanker.js'

test('parse de release completa', () => {
  const r = parseRelease('Duna.Parte.2.2024.1080p.BluRay.DUAL.x265')
  assert.equal(r.quality, '1080p')
  assert.equal(r.source, 'BluRay')
  assert.equal(r.codec, 'x265')
  assert.equal(r.language, 'pt-BR')
  assert.equal(r.dualAudio, true)
  assert.equal(r.year, 2024)
})

test('4K/UHD, WEB-DL e H.264', () => {
  const r = parseRelease('Movie 2023 2160p WEB-DL H.264')
  assert.equal(r.quality, '4K')
  assert.equal(r.source, 'WEB-DL')
  assert.equal(r.codec, 'x264')
  assert.equal(r.language, 'en')
})

test('anime sem PT-BR cai para japonês', () => {
  assert.equal(parseRelease('[Grupo] Anime - 01 [1080p]', { isAnime: true }).language, 'ja')
})

test('anti-CAM detecta variações e não dá falso positivo', () => {
  for (const t of ['Filme.2024.HDTS.x264', 'Filme 2024 CAMRip', 'Filme.TELESYNC.720p', 'Filme-TC-XviD', 'Filme DVDSCR', 'Filme.HDCAM']) {
    assert.equal(isCam(t), true, t)
  }
  for (const t of ['Filme.2024.1080p.BluRay', 'Scam.City.2020.WEB-DL', 'Cats.2019.1080p', 'Tsunami.2022.720p', 'Mr.Robot.S01']) {
    assert.equal(isCam(t), false, t)
  }
  assert.equal(filterCam([{ title: 'A.CAM' }, { title: 'B.1080p' }]).length, 1)
})

test('qualidade máxima por banda', () => {
  assert.equal(maxQualityFor(30), '4K')
  assert.equal(maxQualityFor(10), '1080p')
  assert.equal(maxQualityFor(5), '720p')
  assert.equal(maxQualityFor(2), '480p')
})

test('prioriza pt-BR e respeita a banda', () => {
  const releases = [
    { title: 'Filme.2024.2160p.WEB-DL.x264', score: 90 },
    { title: 'Filme.2024.1080p.WEB-DL.DUAL.x264', score: 70 },
    { title: 'Filme.2024.1080p.BluRay.x264', score: 85 },
    { title: 'Filme.2024.HDTS.x264', score: 99 }
  ]
  const best = pickBestRelease(releases, { maxQuality: '1080p', language: 'pt-BR' })
  assert.equal(best.title, 'Filme.2024.1080p.WEB-DL.DUAL.x264')
  const en = pickBestRelease(releases, { maxQuality: '4K', language: 'en' })
  assert.equal(en.quality, '4K')
})
