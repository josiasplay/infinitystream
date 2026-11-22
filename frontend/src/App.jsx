import { useEffect, useState } from 'react'
import { hasTmdbKey, tmdb } from './api/tmdb.js'
import { catalogItems, isAvailable, loadCatalog } from './api/catalog.js'
import { ENV_BRIDGE_TOKEN, ENV_BRIDGE_URL } from './api/bridge.js'
import { usePreferences } from './hooks/usePreferences.js'
import SearchBar from './components/SearchBar.jsx'
import MediaCard from './components/MediaCard.jsx'
import MediaDetails from './components/MediaDetails.jsx'

// Roteamento por hash (#/movie/123, #/search/duna): 100% estático, sem config no Pages
function parseHash () {
  const [, a = '', b = ''] = window.location.hash.split('/')
  if (a === 'movie' || a === 'tv') return { view: 'details', type: a, id: Number(b) }
  if (a === 'search') return { view: 'search', query: decodeURIComponent(b) }
  return { view: 'home' }
}
const go = path => { window.location.hash = path }

function Row ({ title, items, catalog, loading }) {
  if (!loading && !items?.length) return null
  return (
    <section className='space-y-3'>
      <h2 className='px-4 text-lg font-semibold sm:px-6'>{title}</h2>
      <div className='row-scroll flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6'>
        {loading
          ? Array.from({ length: 8 }, (_, i) => <div key={i} className='aspect-[2/3] w-36 shrink-0 animate-pulse rounded-lg bg-zinc-900 sm:w-40' />)
          : items.map(item => (
            <MediaCard key={`${item.media_type}-${item.id}`} item={item} available={isAvailable(catalog, item.id)} onOpen={i => go(`/${i.media_type}/${i.id}`)} />
          ))}
      </div>
    </section>
  )
}

function useAsync (fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    fn().then(data => alive && setState({ data, loading: false, error: null }))
      .catch(error => alive && setState({ data: null, loading: false, error }))
    return () => { alive = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

function Home ({ catalog }) {
  const rows = useAsync(async () => {
    if (!hasTmdbKey) return {}
    const [trending, nowPlaying, upcoming, tv, anime] = await Promise.allSettled([
      tmdb.trendingMovies(), tmdb.nowPlaying(), tmdb.upcoming(), tmdb.popularTv(), tmdb.anime()
    ]).then(rs => rs.map(r => (r.status === 'fulfilled' ? r.value : [])))
    return { trending, releases: [...nowPlaying, ...upcoming].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i), tv, anime }
  }, [])

  // Pôsteres dos títulos do catálogo que vieram sem poster_path
  const available = useAsync(async () => {
    const items = catalogItems(catalog)
    if (!hasTmdbKey) return items
    return Promise.all(items.map(async it => (it.poster_path
      ? it
      : { ...it, ...(await tmdb.details(it.media_type, it.id).catch(() => ({}))), media_type: it.media_type })))
  }, [catalog])

  return (
    <div className='space-y-10 py-6'>
      <Row title='Disponível para assistir' items={available.data} catalog={catalog} loading={available.loading} />
      <Row title='Populares da semana' items={rows.data?.trending} catalog={catalog} loading={rows.loading} />
      <Row title='Lançamentos' items={rows.data?.releases} catalog={catalog} loading={rows.loading} />
      <Row title='Séries' items={rows.data?.tv} catalog={catalog} loading={rows.loading} />
      <Row title='Animes' items={rows.data?.anime} catalog={catalog} loading={rows.loading} />
    </div>
  )
}

function SearchResults ({ query, catalog }) {
  const res = useAsync(() => (query ? tmdb.search(query) : Promise.resolve([])), [query])
  return (
    <div className='px-4 py-6 sm:px-6'>
      <h1 className='mb-4 text-xl font-semibold'>Resultados para “{query}”</h1>
      {res.error && <p className='text-red-400'>{res.error.message}</p>}
      {!res.loading && res.data?.length === 0 && <p className='text-zinc-400'>Nada encontrado.</p>}
      <div className='flex flex-wrap gap-4'>
        {(res.data || []).map(item => (
          <MediaCard key={`${item.media_type}-${item.id}`} item={item} available={isAvailable(catalog, item.id)} onOpen={i => go(`/${i.media_type}/${i.id}`)} />
        ))}
      </div>
    </div>
  )
}

function Settings ({ onClose }) {
  const [prefs, setPrefs] = usePreferences()
  const [draft, setDraft] = useState(prefs)
  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm'
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4' role='dialog' aria-modal='true' aria-labelledby='settings-title' onClick={onClose}>
      <form
        className='w-full max-w-md space-y-4 rounded-xl bg-zinc-900 p-6 ring-1 ring-zinc-700'
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); setPrefs(draft); sessionStorage.removeItem('infinitystream:net'); onClose() }}
      >
        <h2 id='settings-title' className='text-lg font-semibold'>Configurações</h2>
        <label className='block space-y-1 text-sm'>
          <span>URL da bridge</span>
          <input className={field} value={draft.bridgeUrl} placeholder={ENV_BRIDGE_URL || 'https://bridge.seudominio.com'} onChange={e => setDraft({ ...draft, bridgeUrl: e.target.value.trim() })} />
        </label>
        <label className='block space-y-1 text-sm'>
          <span>Token da bridge {ENV_BRIDGE_TOKEN && <em className='text-zinc-500'>(já definido no build)</em>}</span>
          <input className={field} type='password' autoComplete='off' value={draft.bridgeToken} onChange={e => setDraft({ ...draft, bridgeToken: e.target.value.trim() })} />
          <span className='text-xs text-zinc-500'>Fica salvo só neste navegador (localStorage).</span>
        </label>
        <label className='block space-y-1 text-sm'>
          <span>Idioma preferido</span>
          <select className={field} value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}>
            <option value='pt-BR'>Português (BR)</option>
            <option value='en'>Inglês</option>
            <option value='ja'>Japonês</option>
          </select>
        </label>
        <label className='block space-y-1 text-sm'>
          <span>Modo de reprodução</span>
          <select className={field} value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value })}>
            <option value='auto'>Automático (HTTP direto da bridge — recomendado)</option>
            <option value='p2p'>P2P WebRTC (experimental, mais lento)</option>
            <option value='http'>Somente HTTP via bridge</option>
          </select>
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' checked={draft.subtitles} onChange={e => setDraft({ ...draft, subtitles: e.target.checked })} />
          Ativar legendas automaticamente
        </label>
        <div className='flex justify-end gap-2 pt-2'>
          <button type='button' onClick={onClose} className='rounded-full px-4 py-2 text-sm hover:bg-zinc-800'>Cancelar</button>
          <button type='submit' className='rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong'>Salvar</button>
        </div>
      </form>
    </div>
  )
}

export default function App () {
  const [route, setRoute] = useState(parseHash)
  const [catalog, setCatalog] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prefs] = usePreferences()

  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    loadCatalog().then(setCatalog)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const needsBridge = !(prefs.bridgeUrl || ENV_BRIDGE_URL) || !(prefs.bridgeToken || ENV_BRIDGE_TOKEN)

  return (
    <div className='min-h-dvh'>
      <header className='sticky top-0 z-40 flex items-center gap-4 border-b border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur sm:px-6'>
        <a href='#/' className='flex items-center gap-2 font-bold tracking-tight'>
          <img src='/icon.svg' alt='' className='h-7 w-7' /> <span className='hidden sm:inline'>InfinityStream</span>
        </a>
        <SearchBar initial={route.view === 'search' ? route.query : ''} onSearch={q => go(q ? `/search/${encodeURIComponent(q)}` : '/')} />
        <button type='button' onClick={() => setSettingsOpen(true)} className='ml-auto rounded-full p-2 hover:bg-zinc-800' aria-label='Configurações'>⚙</button>
      </header>

      {!hasTmdbKey && (
        <p className='bg-amber-950 px-4 py-2 text-sm text-amber-200'>VITE_TMDB_API_KEY não configurada: metadados indisponíveis. Veja docs/SETUP.md.</p>
      )}
      {needsBridge && (
        <p className='bg-zinc-900 px-4 py-2 text-sm text-zinc-300'>
          Bridge não configurada. <button type='button' className='underline' onClick={() => setSettingsOpen(true)}>Informe a URL e o token</button> para assistir.
        </p>
      )}

      <main>
        {route.view === 'home' && catalog && <Home catalog={catalog} />}
        {route.view === 'search' && <SearchResults query={route.query} catalog={catalog} />}
        {route.view === 'details' && <MediaDetails type={route.type} id={route.id} catalog={catalog} onBack={() => history.length > 1 ? history.back() : go('/')} />}
      </main>

      <footer className='border-t border-zinc-900 px-6 py-6 text-xs text-zinc-500'>
        Metadados fornecidos por TMDB. Este produto usa a API do TMDB mas não é endossado ou certificado pelo TMDB.
        {catalog?.generated_at && <> · Catálogo atualizado em {new Date(catalog.generated_at).toLocaleString('pt-BR')}</>}
      </footer>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
