/* Service worker do InfinityStream
 * 1. Importa o SW do WebTorrent, que intercepta /webtorrent/* e serve os bytes
 *    do torrent para o <video> (streaming progressivo, com Range).
 * 2. Cache básico do "app shell" para o PWA abrir offline.
 * O SW do WebTorrent registra seu fetch handler primeiro; o nosso só responde
 * quando ele não respondeu (respondWith só pode ser chamado uma vez).
 */
/* global self, caches, importScripts */
importScripts('/webtorrent-sw.min.js')

const CACHE = 'infinitystream-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/webtorrent/')) return // tratado pelo SW do WebTorrent
  if (url.pathname === '/catalog.json') return // sempre da rede (atualiza a cada 6h)

  // Navegação: rede primeiro, cache como fallback offline
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')))
    return
  }
  // Assets com hash do Vite: cache primeiro
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(event.request, copy))
        return res
      }))
    )
  }
})
