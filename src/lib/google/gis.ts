import { GisError } from './errors'

/**
 * Google Identity Services (GIS): öppnar Googles samtyckesfönster och ger en engångskod som
 * Cloud Function `googleConnect` byter mot tokens. Se PROJECT.md §3.
 */

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

/** Den del av GIS som appen använder. */
interface CodeResponse {
  code?: string
  error?: string
}

interface CodeClientError {
  type?: string
}

interface CodeClientConfig {
  client_id: string
  scope: string
  ux_mode: 'popup'
  prompt?: string
  login_hint?: string
  callback: (response: CodeResponse) => void
  error_callback: (error: CodeClientError) => void
}

interface CodeClient {
  requestCode(): void
}

interface GisGlobal {
  accounts: {
    oauth2: {
      initCodeClient(config: CodeClientConfig): CodeClient
    }
  }
}

function getGis(): GisGlobal | undefined {
  const candidate = (window as unknown as { google?: Partial<GisGlobal> }).google
  return candidate?.accounts?.oauth2 ? (candidate as GisGlobal) : undefined
}

let loading: Promise<void> | undefined

/** Läser in GIS-skriptet en gång. Ett misslyckat försök kan göras om. */
export function loadGis(): Promise<void> {
  if (getGis()) return Promise.resolve()
  if (loading) return loading

  const attempt = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.onload = () => {
      resolve()
    }
    script.onerror = () => {
      script.remove()
      reject(new GisError('loadFailed'))
    }
    document.head.append(script)
  })
  loading = attempt.catch((error: unknown) => {
    loading = undefined
    throw error
  })
  return loading
}

export interface AuthCodeRequest {
  clientId: string
  scope: string
  /** E-postadress att förifylla i Googles fönster. */
  loginHint?: string
}

/**
 * Ber användaren godkänna åtkomst och returnerar engångskoden.
 * Kastar `GisError`: `cancelled` om fönstret stängs, `popupBlocked` om webbläsaren stoppar det.
 */
export async function requestAuthCode(request: AuthCodeRequest): Promise<string> {
  await loadGis()
  const gis = getGis()
  if (!gis) throw new GisError('loadFailed')

  return new Promise<string>((resolve, reject) => {
    const client = gis.accounts.oauth2.initCodeClient({
      client_id: request.clientId,
      scope: request.scope,
      ux_mode: 'popup',
      // Utan nytt samtycke skickar Google ingen refresh token om användaren godkänt appen förut.
      prompt: 'consent',
      ...(request.loginHint ? { login_hint: request.loginHint } : {}),
      callback: (response) => {
        if (response.code && !response.error) {
          resolve(response.code)
        } else {
          reject(new GisError(response.error === 'access_denied' ? 'cancelled' : 'failed'))
        }
      },
      error_callback: (error) => {
        if (error.type === 'popup_closed') reject(new GisError('cancelled'))
        else if (error.type === 'popup_failed_to_open') reject(new GisError('popupBlocked'))
        else reject(new GisError('failed'))
      },
    })
    client.requestCode()
  })
}

/** Bara för tester. */
export function resetGisForTests(): void {
  loading = undefined
}
