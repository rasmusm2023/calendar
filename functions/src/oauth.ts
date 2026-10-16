import { z } from 'zod'
import { OAuthError, type CodeExchangeResult, type OAuthClient, type RefreshResult } from './types'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const REQUEST_TIMEOUT_MS = 10_000

const successSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})

const errorSchema = z.object({
  error: z.string(),
})

export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  /** Bara för tester och emulatorn. */
  readonly tokenUrl?: string
  readonly fetchFn?: typeof fetch
}

/** Pratar med Googles token-endpoint. Loggar aldrig tokens eller secrets. */
export function createGoogleOAuthClient(config: GoogleOAuthConfig): OAuthClient {
  const tokenUrl = config.tokenUrl ?? GOOGLE_TOKEN_URL
  const fetchFn = config.fetchFn ?? fetch

  async function requestTokens(
    params: Record<string, string>,
  ): Promise<z.infer<typeof successSchema>> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    })

    let response: Response
    try {
      response = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new OAuthError('unavailable')
    }

    if (response.ok) {
      const parsed = successSchema.safeParse(await readJson(response))
      // Ett lyckat svar vi inte förstår är Googles fel, inte användarens. Försök igen är rimligt.
      if (!parsed.success) throw new OAuthError('unavailable')
      return parsed.data
    }

    if (response.status === 429 || response.status >= 500) {
      throw new OAuthError('unavailable')
    }

    const failure = errorSchema.safeParse(await readJson(response))
    if (failure.success && failure.data.error === 'invalid_grant') {
      throw new OAuthError('invalid_grant')
    }
    // Googles felkod är en kort uppräkning (invalid_client, redirect_uri_mismatch ...). Bara den tas med.
    const googleError =
      failure.success && /^[a-z_]{1,64}$/.test(failure.data.error) ? failure.data.error : undefined
    throw new OAuthError('rejected', googleError)
  }

  return {
    async exchangeCode(code): Promise<CodeExchangeResult> {
      const tokens = await requestTokens({
        grant_type: 'authorization_code',
        code,
        // Koden kommer från Google Identity Services i popup-läge (PROJECT.md §3).
        redirect_uri: 'postmessage',
      })
      return {
        accessToken: tokens.access_token,
        expiresInSeconds: tokens.expires_in,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope ?? '',
      }
    },

    async refreshAccessToken(refreshToken): Promise<RefreshResult> {
      const tokens = await requestTokens({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
      return { accessToken: tokens.access_token, expiresInSeconds: tokens.expires_in }
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}
