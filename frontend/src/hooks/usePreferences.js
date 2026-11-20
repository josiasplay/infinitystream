// Preferências do usuário persistidas em localStorage e compartilhadas entre componentes.
import { useSyncExternalStore, useCallback } from 'react'

const KEY = 'infinitystream:prefs'
const DEFAULTS = {
  language: 'pt-BR', // pt-BR | en | ja
  quality: 'auto', // auto | 4K | 1080p | 720p | 480p
  mode: 'auto', // auto (P2P com fallback HTTP) | p2p | http
  subtitles: true,
  bridgeUrl: '',
  bridgeToken: ''
}

const listeners = new Set()
let state = read()

function read () {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

function write (next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado */ }
  listeners.forEach(l => l())
}

const subscribe = l => { listeners.add(l); return () => listeners.delete(l) }

export function usePreferences () {
  const prefs = useSyncExternalStore(subscribe, () => state)
  const setPrefs = useCallback(patch => write({ ...state, ...(typeof patch === 'function' ? patch(state) : patch) }), [])
  return [prefs, setPrefs]
}
