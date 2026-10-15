import type { GoogleFunctionsClient } from '@/lib/firebase'
import {
  GOOGLE_CALENDAR_SCOPE,
  createTokenManager,
  requestAuthCode as defaultRequestAuthCode,
  type AuthCodeRequest,
} from '@/lib/google'
import type { GoogleAccessService } from './types'

interface GoogleAccessServiceOptions {
  /** OAuth-klientens ID (publikt). */
  clientId: string
  functions: GoogleFunctionsClient
  /** Byts ut i tester. */
  requestAuthCode?: (request: AuthCodeRequest) => Promise<string>
}

/**
 * Knyter ihop Googles samtyckesfönster, Cloud Functions och token i minnet. Refresh token finns
 * aldrig här: den stannar på servern.
 */
export function createGoogleAccessService({
  clientId,
  functions,
  requestAuthCode = defaultRequestAuthCode,
}: GoogleAccessServiceOptions): GoogleAccessService {
  const tokens = createTokenManager({ source: functions })

  return {
    getAccessToken: () => tokens.getAccessToken(),

    async connect(loginHint) {
      const code = await requestAuthCode({
        clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        ...(loginHint ? { loginHint } : {}),
      })
      const { accessToken, expiresAt } = await functions.connect(code)
      tokens.setToken({ accessToken, expiresAt })
    },

    invalidateToken: () => {
      tokens.invalidate()
    },

    clear: () => {
      tokens.clear()
    },
  }
}
