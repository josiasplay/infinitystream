// Cliente HTTP da bridge Oracle. URL/token vêm das preferências (localStorage)
// com fallback para as variáveis VITE_* do build.
export const ENV_BRIDGE_URL = (import.meta.env.VITE_ORACLE_BRIDGE_URL || '').replace(/\/$/, '')
export const ENV_BRIDGE_TOKEN = import.meta.env.VITE_BRIDGE_TOKEN || ''

export function bridgeConfig (prefs = {}) {
  return {
    url: (prefs.bridgeUrl || ENV_BRIDGE_URL).replace(/\/$/, ''),
    token: prefs.bridgeToken || ENV_BRIDGE_TOKEN
  }
}

export async function bridgeFetch ({ url, token }, path, { method = 'GET', body, signal, timeoutMs = 60000 } = {}) {
  if (!url) throw new Error('URL da bridge não configurada (Configurações)')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('tempo esgotado falando com a bridge')), timeoutMs)
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true })
  try {
    const res = await fetch(url + path, {
      method,
      signal: ctrl.signal,
      headers: { 'X-Bridge-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `bridge respondeu ${res.status}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}
