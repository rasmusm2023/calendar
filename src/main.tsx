import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, applySystemTheme } from '@/app'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

applySystemTheme()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
