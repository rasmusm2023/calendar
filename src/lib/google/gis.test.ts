import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GisError, type GisErrorKind } from './errors'
import { GIS_SCRIPT_URL, loadGis, requestAuthCode, resetGisForTests } from './gis'

interface FakeConfig {
  client_id: string
  scope: string
  ux_mode: string
  prompt?: string
  login_hint?: string
  callback: (response: { code?: string; error?: string }) => void
  error_callback: (error: { type?: string }) => void
}

interface GoogleWindow {
  google?: unknown
}

function installGis(onRequest: (config: FakeConfig) => void) {
  const initCodeClient = vi.fn((config: FakeConfig) => ({
    requestCode: () => {
      onRequest(config)
    },
  }))
  ;(window as unknown as GoogleWindow).google = { accounts: { oauth2: { initCodeClient } } }
  return initCodeClient
}

async function kindOf(promise: Promise<unknown>): Promise<GisErrorKind> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GisError) return error.kind
    throw error
  }
  throw new Error('Förväntade ett GisError men anropet lyckades')
}

beforeEach(() => {
  resetGisForTests()
})

afterEach(() => {
  delete (window as unknown as GoogleWindow).google
  document.head.querySelectorAll('script').forEach((script) => {
    script.remove()
  })
})

describe('requestAuthCode', () => {
  it('ber om kalenderbehörighet i popup med nytt samtycke och ger tillbaka koden', async () => {
    const initCodeClient = installGis((config) => {
      config.callback({ code: 'one-time-code' })
    })

    const code = await requestAuthCode({
      clientId: 'client-id',
      scope: 'the-scope',
      loginHint: 'me@example.com',
    })

    expect(code).toBe('one-time-code')
    expect(initCodeClient).toHaveBeenCalledTimes(1)
    expect(initCodeClient.mock.calls[0]?.[0]).toMatchObject({
      client_id: 'client-id',
      scope: 'the-scope',
      ux_mode: 'popup',
      prompt: 'consent',
      login_hint: 'me@example.com',
    })
  })

  it('utelämnar login_hint när ingen anges', async () => {
    const initCodeClient = installGis((config) => {
      config.callback({ code: 'c' })
    })

    await requestAuthCode({ clientId: 'id', scope: 's' })

    expect(initCodeClient.mock.calls[0]?.[0]).not.toHaveProperty('login_hint')
  })

  it('tolkar ett stängt fönster som avbrutet', async () => {
    installGis((config) => {
      config.error_callback({ type: 'popup_closed' })
    })
    expect(await kindOf(requestAuthCode({ clientId: 'id', scope: 's' }))).toBe('cancelled')
  })

  it('tolkar nekat samtycke som avbrutet', async () => {
    installGis((config) => {
      config.callback({ error: 'access_denied' })
    })
    expect(await kindOf(requestAuthCode({ clientId: 'id', scope: 's' }))).toBe('cancelled')
  })

  it('tolkar ett blockerat fönster', async () => {
    installGis((config) => {
      config.error_callback({ type: 'popup_failed_to_open' })
    })
    expect(await kindOf(requestAuthCode({ clientId: 'id', scope: 's' }))).toBe('popupBlocked')
  })

  it('tolkar övriga fel och svar utan kod som misslyckande', async () => {
    installGis((config) => {
      config.error_callback({ type: 'unknown' })
    })
    expect(await kindOf(requestAuthCode({ clientId: 'id', scope: 's' }))).toBe('failed')

    installGis((config) => {
      config.callback({})
    })
    expect(await kindOf(requestAuthCode({ clientId: 'id', scope: 's' }))).toBe('failed')
  })
})

describe('loadGis', () => {
  it('lägger in skriptet en gång och väntar på att det laddats', async () => {
    const first = loadGis()
    const second = loadGis()

    const scripts = document.head.querySelectorAll<HTMLScriptElement>('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.src).toBe(GIS_SCRIPT_URL)

    scripts[0]?.dispatchEvent(new Event('load'))
    await Promise.all([first, second])
  })

  it('hoppar över skriptet när GIS redan finns', async () => {
    installGis(() => undefined)

    await loadGis()

    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })

  it('rapporterar att skriptet inte gick att ladda och tillåter nytt försök', async () => {
    const failing = loadGis()
    document.head.querySelector('script')?.dispatchEvent(new Event('error'))
    expect(await kindOf(failing)).toBe('loadFailed')

    const retry = loadGis()
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    scripts[0]?.dispatchEvent(new Event('load'))
    await retry
  })
})
