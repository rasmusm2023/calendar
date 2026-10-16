import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App, ConfigErrorScreen, QueryProvider, applySystemTheme } from '@/app'
import { AuthProvider, createFirebaseAuthService } from '@/features/auth'
import { GoogleAccessProvider, createGoogleAccessService } from '@/features/google-access'
import { setupAppI18n } from '@/i18n'
import {
  EnvError,
  createFirebaseTransport,
  createGoogleFunctionsClient,
  getEnv,
  getFirebase,
} from '@/lib/firebase'
import './index.css'

function createContent(): ReactNode {
  try {
    const { auth, functions } = getFirebase()
    const googleAccess = createGoogleAccessService({
      clientId: getEnv().googleClientId,
      functions: createGoogleFunctionsClient(createFirebaseTransport(functions)),
    })
    return (
      <AuthProvider service={createFirebaseAuthService(auth)}>
        <GoogleAccessProvider service={googleAccess}>
          <QueryProvider>
            <App />
          </QueryProvider>
        </GoogleAccessProvider>
      </AuthProvider>
    )
  } catch (error) {
    if (error instanceof EnvError) {
      return <ConfigErrorScreen details={error.message} />
    }
    throw error
  }
}

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element #root not found')
  }

  applySystemTheme()
  const i18n = await setupAppI18n()

  createRoot(rootElement).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>{createContent()}</I18nextProvider>
    </StrictMode>,
  )
}

void bootstrap()
