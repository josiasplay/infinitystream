import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'

// Service worker: PWA + streaming do WebTorrent (obrigatório para o modo P2P)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
    console.warn('[sw] falha ao registrar; modo P2P indisponível, usando HTTP', err)
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
