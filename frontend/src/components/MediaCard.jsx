import { img } from '../api/tmdb.js'

export default function MediaCard ({ item, available, onOpen }) {
  const title = item.title || item.name
  const year = (item.release_date || item.first_air_date || '').slice(0, 4)
  const poster = img(item.poster_path, 'w342')
  return (
    <button
      type='button'
      onClick={() => onOpen(item)}
      className='group relative w-36 shrink-0 text-left sm:w-40 focus:outline-none'
      title={title}
    >
      <div className='aspect-[2/3] overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition group-hover:ring-accent group-focus-visible:ring-2 group-focus-visible:ring-accent'>
        {poster
          ? <img src={poster} alt='' loading='lazy' className='h-full w-full object-cover transition group-hover:scale-105' />
          : <div className='flex h-full items-center justify-center p-3 text-center text-sm text-zinc-400'>{title}</div>}
      </div>
      {available && (
        <span className='absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow'>
          Disponível
        </span>
      )}
      <p className='mt-2 line-clamp-2 text-sm font-medium'>{title}</p>
      {year && <p className='text-xs text-zinc-500'>{year}</p>}
    </button>
  )
}
