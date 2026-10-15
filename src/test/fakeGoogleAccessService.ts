import { vi } from 'vitest'
import type { GoogleAccessService } from '@/features/google-access'
import {
  GisError,
  GoogleAccessError,
  type GisErrorKind,
  type GoogleAccessReason,
} from '@/lib/google'

/**
 * Fejkad GoogleAccessService för tester. `initial` styr vad den första kontrollen (getAccessToken) ger:
 * en token (kopplad) eller ett orsaksfel (t.ex. 'not_connected').
 */
export function createFakeGoogleAccessService(
  initial: 'connected' | GoogleAccessReason = 'connected',
) {
  let connected = initial === 'connected'
  let nextConnectError: GisError | GoogleAccessError | null = null

  const getAccessToken = vi.fn(async () => {
    await Promise.resolve()
    if (connected) return 'fake-access-token'
    throw new GoogleAccessError(initial === 'connected' ? 'unknown' : initial)
  })
  const connect = vi.fn<GoogleAccessService['connect']>(async () => {
    await Promise.resolve()
    if (nextConnectError) {
      const error = nextConnectError
      nextConnectError = null
      throw error
    }
    connected = true
  })
  const invalidateToken = vi.fn()
  const clear = vi.fn()

  const service: GoogleAccessService = {
    getAccessToken: () => getAccessToken(),
    connect: (loginHint) => connect(loginHint),
    invalidateToken: () => {
      invalidateToken()
    },
    clear: () => {
      clear()
    },
  }

  return {
    service,
    spies: { getAccessToken, connect, invalidateToken, clear },
    /** Nästa kontroll lyckas (t.ex. efter att nätverket kommit tillbaka). */
    setConnected() {
      connected = true
    },
    failNextConnect(error: GisError | GoogleAccessError) {
      nextConnectError = error
    },
    failNextConnectWithGis(kind: GisErrorKind) {
      nextConnectError = new GisError(kind)
    },
  }
}
