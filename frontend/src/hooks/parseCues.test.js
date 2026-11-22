import { describe, expect, it } from 'vitest'
import { parseCues } from './useTorrent.js'

describe('parseCues', () => {
  it('lê SRT com vírgula nos milissegundos', () => {
    const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\nOlá\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nLinha 1\r\nLinha 2\r\n'
    expect(parseCues(srt)).toEqual([
      { start: 1.5, end: 3, text: 'Olá' },
      { start: 62, end: 64.25, text: 'Linha 1\nLinha 2' }
    ])
  })

  it('lê WebVTT do ffmpeg (com e sem hora) e ignora o cabeçalho', () => {
    const vtt = 'WEBVTT\n\n00:05.000 --> 00:07.000\nCurta\n\n01:00:00.000 --> 01:00:02.000 align:center\n<i>Longa</i>\n'
    expect(parseCues(vtt)).toEqual([
      { start: 5, end: 7, text: 'Curta' },
      { start: 3600, end: 3602, text: '<i>Longa</i>' }
    ])
  })

  it('aceita arquivo parcial (último bloco ainda sem texto)', () => {
    const partial = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOk\n\n00:00:03.000 --> 00:00:04.000\n'
    expect(parseCues(partial)).toEqual([{ start: 1, end: 2, text: 'Ok' }])
  })
})
