import React from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles.css'
import App from './App'

// The service worker is registered in App (useRegisterSW): a new version is
// offered in a banner, never applied by an automatic reload.

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
