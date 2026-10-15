import { z } from 'zod'
import {
  CALENDAR_SCOPE,
  GoogleAccessError,
  OAuthError,
  type AccessTokenResponse,
  type ConnectResponse,
  type Dependencies,
} from './types'

const connectInputSchema = z.object({
  code: z.string().min(1).max(2048),
})

const MS_PER_SECOND = 1000

function hasCalendarScope(scope: string): boolean {
  return scope.split(/\s+/).includes(CALENDAR_SCOPE)
}

/**
 * Byter engångskoden från Google Identity Services mot tokens och sparar refresh token.
 * Returnerar första access token direkt så att klienten slipper ett extra anrop.
 */
export async function connectGoogle(
  deps: Dependencies,
  uid: string,
  rawInput: unknown,
): Promise<ConnectResponse> {
  const input = connectInputSchema.safeParse(rawInput)
  if (!input.success) {
    throw new GoogleAccessError('invalid_request')
  }

  let exchange
  try {
    exchange = await deps.oauth.exchangeCode(input.data.code)
  } catch (error) {
    if (error instanceof OAuthError) {
      if (error.kind === 'invalid_grant') throw new GoogleAccessError('code_exchange_failed')
      if (error.kind === 'unavailable') throw new GoogleAccessError('google_unavailable')
    }
    throw error
  }

  // Google låter användaren avmarkera enskilda behörigheter. Utan kalenderbehörighet är kopplingen värdelös.
  if (!hasCalendarScope(exchange.scope)) {
    throw new GoogleAccessError('insufficient_scope')
  }

  // Google skickar bara refresh token vid första samtycket (eller med prompt=consent). Saknas den
  // behåller vi den vi redan har, och finns ingen alls måste klienten be om samtycke på nytt.
  const refreshToken = exchange.refreshToken ?? (await deps.store.get(uid))?.refreshToken
  if (refreshToken === undefined) {
    throw new GoogleAccessError('no_refresh_token')
  }

  const now = deps.now()
  await deps.store.save(uid, { refreshToken, scope: exchange.scope, connectedAt: now })

  return {
    accessToken: exchange.accessToken,
    expiresAt: now + exchange.expiresInSeconds * MS_PER_SECOND,
    scope: exchange.scope,
  }
}

/** Ger en ny access token. En återkallad refresh token tas bort så att den inte ligger kvar i onödan. */
export async function getAccessToken(
  deps: Dependencies,
  uid: string,
): Promise<AccessTokenResponse> {
  const stored = await deps.store.get(uid)
  if (stored === null) {
    throw new GoogleAccessError('not_connected')
  }

  try {
    const refreshed = await deps.oauth.refreshAccessToken(stored.refreshToken)
    return {
      accessToken: refreshed.accessToken,
      expiresAt: deps.now() + refreshed.expiresInSeconds * MS_PER_SECOND,
    }
  } catch (error) {
    if (error instanceof OAuthError) {
      if (error.kind === 'invalid_grant') {
        await deps.store.delete(uid)
        throw new GoogleAccessError('access_revoked')
      }
      if (error.kind === 'unavailable') throw new GoogleAccessError('google_unavailable')
    }
    throw error
  }
}
