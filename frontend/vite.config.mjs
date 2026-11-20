import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// O WebTorrent no navegador (v2+) faz streaming para o <video> através de um
// service worker próprio (sw.min.js). Este plugin publica o arquivo em
// /webtorrent-sw.min.js tanto no dev server quanto no build, onde o nosso
// public/sw.js o importa via importScripts().
function webtorrentServiceWorker () {
  const swPath = fileURLToPath(import.meta.resolve('webtorrent/dist/sw.min.js'))
  return {
    name: 'webtorrent-sw',
    configureServer (server) {
      server.middlewares.use('/webtorrent-sw.min.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript')
        res.end(fs.readFileSync(swPath))
      })
    },
    generateBundle () {
      this.emitFile({ type: 'asset', fileName: 'webtorrent-sw.min.js', source: fs.readFileSync(swPath) })
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), webtorrentServiceWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500 // bundle do WebTorrent é grande (~600 KB)
  }
})
