function fmtSpeed (bytesPerSec) {
  if (bytesPerSec == null) return '—'
  const kb = bytesPerSec / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${kb.toFixed(0)} KB/s`
}

function Stat ({ label, value, warn }) {
  return (
    <div className='min-w-20'>
      <dt className='text-[10px] uppercase tracking-wide text-zinc-500'>{label}</dt>
      <dd className={`font-mono text-sm ${warn ? 'text-amber-400' : 'text-zinc-100'}`}>{value}</dd>
    </div>
  )
}

/** Métricas em tempo real: velocidade, peers, ping, buffer e progresso. */
export default function ConnectionStats ({ stats, latencyMs, bufferSec, mode }) {
  return (
    <dl className='flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-zinc-900/80 px-4 py-3 ring-1 ring-zinc-800'>
      <Stat label='Modo' value={mode === 'p2p' ? 'P2P (WebRTC)' : mode === 'http' ? 'HTTP (bridge)' : '—'} />
      <Stat label='Download' value={fmtSpeed(stats?.downloadSpeed)} />
      <Stat label={stats?.source === 'bridge' ? 'Peers da bridge' : 'Peers'} value={stats?.peers ?? '—'} warn={stats && stats.peers === 0} />
      <Stat label='Ping' value={latencyMs != null ? `${latencyMs} ms` : '—'} warn={latencyMs > 250} />
      <Stat label='Buffer' value={bufferSec != null ? `${bufferSec.toFixed(0)} s` : '—'} warn={bufferSec != null && bufferSec < 5} />
      <Stat label='Baixado' value={stats?.progress != null ? `${(stats.progress * 100).toFixed(1)}%` : '—'} />
    </dl>
  )
}
