import { useEffect, useMemo, useState } from 'react'
import { img, pickTrailer, tmdb } from '../api/tmdb.js'
import { catalogEntry } from '../api/catalog.js'
import { bridgeConfig } from '../api/bridge.js'
import { usePreferences } from '../hooks/usePreferences.js'
import { codecSupport, useNetworkQuality } from '../hooks/useNetworkQuality.js'
import { rankReleases } from '../utils/qualityRanker.js'
import { LANGUAGE_LABEL } from '../utils/releaseParser.js'
import QualitySelector from './QualitySelector.jsx'
import LanguageSelector from './LanguageSelector.jsx'
import TorrentPlayer from './TorrentPlayer.jsx'

export default function MediaDetails ({ type, id, catalog, onBack }) {
  const [prefs, setPrefs] = usePreferences()
  const bridge = bridgeConfig(prefs)
  const net = useNetworkQuality(bridge)
  const [details, setDetails] = useState(null)
  const [error, setError] = useState(null)
  const [showTrailer, setShowTrailer] = useState(false)
  const [playing, setPlaying] = useState(null)

  useEffect(() => {
    setDetails(null); setError(null); setPlaying(null); setShowTrailer(false)
    tmdb.details(type, id).then(setDetails).catch(e => setError(e.message))
  }, [type, id])

  const entry = catalogEntry(catalog, id)
  const isAnime = Boolean(entry?.is_anime || (details && details.genres?.some(g => g.id === 16) && details.original_language === 'ja'))
  const hevc = useMemo(() => codecSupport().hevc, [])
  const maxQuality = prefs.quality === 'auto' ? (net.maxQuality || '1080p') : prefs.quality

  const ranked = useMemo(
    () => rankReleases(entry?.releases || [], { maxQuality, language: prefs.language, isAnime, hevcSupported: hevc }),
    [entry, maxQuality, prefs.language, isAnime, hevc]
  )
  const best = ranked[0] || null

  const title = details?.title || details?.name || entry?.title_pt_br || ''
  const year = (details?.release_date || details?.first_air_date || '').slice(0, 4)
  const trailer = pickTrailer(details?.videos)
  const backdrop = img(details?.backdrop_path, 'w1280')

  if (error && !entry) return <p className='p-8 text-red-400'>Erro ao carregar: {error}</p>

  return (
    <article className='pb-16'>
      <div className='relative'>
        {backdrop && <img src={backdrop} alt='' className='absolute inset-0 h-full w-full object-cover opacity-25' />}
        <div className='absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent' />
        <div className='relative mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:px-6'>
          <button type='button' onClick={onBack} className='absolute left-4 top-2 text-sm text-zinc-400 hover:text-white sm:left-6'>← Voltar</button>
          <img src={img(details?.poster_path || entry?.poster_path, 'w342') || '/icon.svg'} alt='' className='mt-6 w-40 shrink-0 self-start rounded-lg shadow-xl ring-1 ring-zinc-800 sm:w-52' />
          <div className='mt-6 space-y-3'>
            <h1 className='text-3xl font-bold'>{title} {year && <span className='font-normal text-zinc-400'>({year})</span>}</h1>
            <p className='text-sm text-zinc-400'>
              {(details?.genres || []).map(g => g.name).join(' · ')}
              {details?.runtime ? ` · ${details.runtime} min` : ''}
              {details?.number_of_seasons ? ` · ${details.number_of_seasons} temporada(s)` : ''}
              {details?.vote_average ? ` · ★ ${details.vote_average.toFixed(1)}` : ''}
            </p>
            {details?.tagline && <p className='italic text-zinc-300'>{details.tagline}</p>}
            <p className='max-w-3xl leading-relaxed text-zinc-200'>{details?.overview || 'Sinopse indisponível em português.'}</p>
            <div className='flex flex-wrap gap-3 pt-2'>
              {best && !playing && (
                <button type='button' onClick={() => setPlaying(best)} className='rounded-full bg-accent px-6 py-2 font-semibold text-white hover:bg-accent-strong'>
                  ▶ Assistir ({best.quality} · {LANGUAGE_LABEL[best.language] || best.language})
                </button>
              )}
              {trailer && (
                <button type='button' onClick={() => setShowTrailer(s => !s)} className='rounded-full border border-zinc-700 px-5 py-2 hover:border-zinc-400'>
                  {showTrailer ? 'Fechar trailer' : 'Trailer'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className='mx-auto max-w-6xl space-y-8 px-4 sm:px-6'>
        {playing && (
          <TorrentPlayer
            key={playing.magnet || playing.torrent_url}
            title={title}
            release={playing}
            releases={ranked}
            onSelectRelease={setPlaying}
            onClose={() => setPlaying(null)}
          />
        )}

        {showTrailer && trailer && (
          <div className='aspect-video overflow-hidden rounded-xl ring-1 ring-zinc-800'>
            <iframe
              className='h-full w-full'
              src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1`}
              title={`Trailer de ${title}`}
              allow='autoplay; encrypted-media; picture-in-picture'
              allowFullScreen
            />
          </div>
        )}

        <section className='space-y-3'>
          <div className='flex flex-wrap items-center gap-4'>
            <h2 className='text-lg font-semibold'>Fontes</h2>
            <QualitySelector value={prefs.quality} onChange={quality => setPrefs({ quality })} available={ranked.map(r => r.quality)} recommended={net.maxQuality} />
            <LanguageSelector value={prefs.language} onChange={language => setPrefs({ language })} available={ranked.map(r => r.language)} />
            <span className='text-xs text-zinc-500'>
              {net.measuring ? 'Medindo conexão…' : net.mbps != null ? `Conexão: ${net.mbps} Mbps · ${net.latencyMs ?? '?'} ms` : ''}
            </span>
          </div>
          {ranked.length === 0
            ? (
              <p className='rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400 ring-1 ring-zinc-800'>
                Nenhuma fonte deste título no seu catálogo. Adicione um magnet em <code>catalog-sources/magnets.json</code> (conteúdo que você tem direito de usar) e rode o workflow.
              </p>
              )
            : (
              <ul className='divide-y divide-zinc-800 overflow-hidden rounded-lg ring-1 ring-zinc-800'>
                {ranked.map((r, i) => (
                  <li key={r.magnet || r.torrent_url || i} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${r === playing ? 'bg-accent/10' : 'bg-zinc-900/50'}`}>
                    <span className='w-14 font-semibold'>{r.quality}</span>
                    <span className='w-28'>{LANGUAGE_LABEL[r.language] || r.language}{r.dualAudio ? ' (DUAL)' : ''}</span>
                    <span className='w-20 text-zinc-400'>{r.source}</span>
                    <span className='w-16 text-zinc-400'>{r.codec}</span>
                    <span className='w-20 text-zinc-400'>{r.size_gb ? `${r.size_gb} GB` : ''}</span>
                    <span className='w-24 text-zinc-400'>{r.webseed ? 'webseed' : r.seeders != null ? `${r.seeders} seeds` : ''}</span>
                    {r.episode && <span className='text-zinc-400'>{r.episode}</span>}
                    {i === 0 && <span className='rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300'>recomendado</span>}
                    {r.codec === 'x265' && !hevc && <span className='rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase text-amber-300'>HEVC sem suporte</span>}
                    <button type='button' onClick={() => setPlaying(r)} className='ml-auto rounded-full border border-zinc-700 px-3 py-1 hover:border-accent'>Assistir</button>
                  </li>
                ))}
              </ul>
              )}
        </section>

        {details?.credits?.cast?.length > 0 && (
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>Elenco</h2>
            <ul className='row-scroll flex gap-4 overflow-x-auto pb-2'>
              {details.credits.cast.slice(0, 15).map(p => (
                <li key={p.credit_id} className='w-24 shrink-0 text-center text-xs'>
                  <div className='mx-auto mb-1 h-24 w-24 overflow-hidden rounded-full bg-zinc-800'>
                    {p.profile_path && <img src={img(p.profile_path, 'w185')} alt='' loading='lazy' className='h-full w-full object-cover' />}
                  </div>
                  <p className='font-medium'>{p.name}</p>
                  <p className='text-zinc-500'>{p.character}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  )
}
