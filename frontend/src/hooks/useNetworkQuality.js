// Mede latência e banda até a bridge para escolher a qualidade automaticamente.
import { useCallback, useEffect, useState } from 'react'
import { maxQualityFor } from '../utils/qualityRanker.js'

const CACHE_KEY = 'infinitystream:net'
const CACHE_MS = 10 * 60 * 1000
const SPEEDTEST_BYTES = 2 * 1024 * 1024

export async function pingBridge (url) {
  const t0 = performance.now()
  const res = await fetch(`${url}/health`, { cache: 'no-store' })
  await res.json()
  return Math.round(performance.now() - t0)
}

async function measureMbps (url, token) {
  const t0 = performance.now()
  const res = await fetch(`${url}/speedtest?bytes=${SPEEDTEST_BYTES}`, {
    cache: 'no-store',
    headers: { 'X-Bridge-Token': token }
  })
  if (!res.ok) throw new Error(`speedtest ${res.status}`)
  const buf = await res.arrayBuffer()
  const seconds = (performance.now() - t0) / 1000
  return Number(((buf.byteLength * 8) / seconds / 1e6).toFixed(1))
}

/** Suporte do navegador a codecs relevantes (Direct Play: sem suporte = não toca). */
export function codecSupport () {
  const ms = typeof MediaSource !== 'undefined' ? MediaSource : null
  const v = document.createElement('video')
  const can = t => Boolean((ms?.isTypeSupported?.(t)) || v.canPlayType(t))
  return {
    h264: can('video/mp4; codecs="avc1.640028"'),
    hevc: can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"'),
    av1: can('video/mp4; codecs="av01.0.08M.08"'),
    // Chrome/Edge tocam MKV mesmo respondendo '' em canPlayType; detectamos pelo UA
    mkv: v.canPlayType('video/x-matroska') !== '' || /Chrome|Edg\//.test(navigator.userAgent)
  }
}

export function useNetworkQuality ({ url, token }) {
  const [net, setNet] = useState(() => {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (c && Date.now() - c.at < CACHE_MS && c.url === url) return c
    } catch { /* ignora */ }
    return { latencyMs: null, mbps: null, maxQuality: null, measuring: false }
  })

  const measure = useCallback(async () => {
    if (!url) return
    setNet(n => ({ ...n, measuring: true }))
    let latencyMs = null
    let mbps = null
    try {
      const pings = []
      for (let i = 0; i < 3; i++) pings.push(await pingBridge(url))
      latencyMs = pings.sort((a, b) => a - b)[1] // mediana
    } catch { /* bridge fora do ar */ }
    try {
      if (token) mbps = await measureMbps(url, token)
    } catch { /* sem token ou falhou */ }
    // Fallback: estimativa do navegador (Chrome limita a 10 Mbps)
    if (mbps == null && navigator.connection?.downlink) mbps = navigator.connection.downlink
    const result = { latencyMs, mbps, maxQuality: maxQualityFor(mbps), measuring: false, at: Date.now(), url }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(result))
    setNet(result)
  }, [url, token])

  useEffect(() => {
    if (url && net.mbps == null && !net.measuring && !net.at) measure()
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...net, measure }
}
