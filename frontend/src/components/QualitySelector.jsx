import { QUALITY_RANK } from '../utils/qualityRanker.js'

/** Seletor de qualidade: "Automática" usa a banda medida; as demais forçam o override. */
export default function QualitySelector ({ value, onChange, available = [], recommended }) {
  const options = [...new Set(available)].sort((a, b) => (QUALITY_RANK[b] ?? 0) - (QUALITY_RANK[a] ?? 0))
  return (
    <label className='flex items-center gap-2 text-sm'>
      <span className='text-zinc-400'>Qualidade</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className='rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1'
      >
        <option value='auto'>Automática{recommended ? ` (até ${recommended})` : ''}</option>
        {options.map(q => <option key={q} value={q}>{q}</option>)}
      </select>
    </label>
  )
}
