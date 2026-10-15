import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App, applySystemTheme } from '@/app'
import { setupAppI18n } from '@/i18n'
import './index.css'

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element #root not found')
  }

  applySystemTheme()
  const i18n = await setupAppI18n()

  createRoot(rootElement).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  )
}

void bootstrap()
