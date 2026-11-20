import { useEffect, useState } from 'react'

export default function SearchBar ({ initial = '', onSearch }) {
  const [q, setQ] = useState(initial)
  useEffect(() => setQ(initial), [initial])

  // Busca com debounce de 400ms enquanto digita
  useEffect(() => {
    if (q.trim() === initial.trim()) return
    const t = setTimeout(() => onSearch(q.trim()), 400)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form
      role='search'
      className='flex-1 max-w-md'
      onSubmit={e => { e.preventDefault(); onSearch(q.trim()) }}
    >
      <label className='sr-only' htmlFor='search'>Buscar filmes, séries e animes</label>
      <input
        id='search'
        type='search'
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder='Buscar filmes, séries e animes…'
        className='w-full rounded-full bg-zinc-900 border border-zinc-800 px-4 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'
      />
    </form>
  )
}
