import { LANGUAGE_LABEL } from '../utils/releaseParser.js'

/**
 * Idioma preferido da release (dublado/legendado). A troca de faixa de áudio
 * dentro do arquivo (DUAL) é feita no player, via video.audioTracks.
 */
export default function LanguageSelector ({ value, onChange, available = [] }) {
  const langs = [...new Set(['pt-BR', ...available])]
  return (
    <label className='flex items-center gap-2 text-sm'>
      <span className='text-zinc-400'>Áudio</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className='rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1'
      >
        {langs.map(l => (
          <option key={l} value={l}>
            {LANGUAGE_LABEL[l] || l}{available.includes(l) ? '' : ' (indisponível)'}
          </option>
        ))}
      </select>
    </label>
  )
}
