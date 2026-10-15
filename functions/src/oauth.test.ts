import { describe, expect, it } from 'vitest'
import { createGoogleOAuthClient, GOOGLE_TOKEN_URL } from './oauth'
import { OAuthError } from './types'

interface RecordedRequest {
  url: string
  body: URLSearchParams
  contentType: string | null
}

function createFetch(respond: () => Response | Promise<Response>) {
  const requests: RecordedRequest[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      body: new URLSearchParams(init?.body as URLSearchParams),
      contentType: headers.get('Content-Type'),
    })
    return respond()
  }
  return { fetchFn, requests }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clientWith(respond: () => Response | Promise<Response>) {
  const { fetchFn, requests } = createFetch(respond)
  const client = createGoogleOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchFn,
  })
  return { client, requests }
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OAuthError) return error.kind
    throw error
  }
  throw new Error('Förväntade ett OAuthError men anropet lyckades')
}

describe('exchangeCode', () => {
  it('skickar rätt formulär till Googles token-endpoint och tolkar svaret', async () => {
    const { client, requests } = clientWith(() =>
      json({
        access_token: 'access',
        expires_in: 3599,
        refresh_token: 'refresh',
        scope: 'openid calendar',
        token_type: 'Bearer',
      }),
    )

    const result = await client.exchangeCode('the-code')

    expect(result).toEqual({
      accessToken: 'access',
      expiresInSeconds: 3599,
      refreshToken: 'refresh',
      scope: 'openid calendar',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(GOOGLE_TOKEN_URL)
    expect(requests[0]?.contentType).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(requests[0]?.body ?? [])).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'postmessage',
    })
  })

  it('tillåter svar utan refresh token', async () => {
    const { client } = clientWith(() =>
      json({ access_token: 'access', expires_in: 3599, scope: 'calendar' }),
    )

    expect((await client.exchangeCode('c')).refreshToken).toBeUndefined()
  })

  it('tolkar invalid_grant (förbrukad eller ogiltig kod)', async () => {
    const { client } = clientWith(() => json({ error: 'invalid_grant' }, 400))
    expect(await kindOf(client.exchangeCode('c'))).toBe('invalid_grant')
  })

  it('tolkar fel client secret som ett konfigurationsfel', async () => {
    const { client } = clientWith(() => json({ error: 'invalid_client' }, 401))
    expect(await kindOf(client.exchangeCode('c'))).toBe('rejected')
  })

  it.each([429, 500, 503])('behandlar HTTP %i som tillfälligt fel', async (status) => {
    const { client } = clientWith(() => json({ error: 'backend_error' }, status))
    expect(await kindOf(client.exchangeCode('c'))).toBe('unavailable')
  })

  it('behandlar nätverksfel som tillfälligt fel', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('fetch failed')
    })
    expect(await kindOf(client.exchangeCode('c'))).toBe('unavailable')
  })

  it('behandlar ett lyckat men oförståeligt svar som tillfälligt fel', async () => {
    const { client } = clientWith(() => json({ unexpected: true }))
    expect(await kindOf(client.exchangeCode('c'))).toBe('unavailable')
  })

  it('klarar ett felsvar som inte är JSON', async () => {
    const { client } = clientWith(() => new Response('<html>Bad gateway</html>', { status: 400 }))
    expect(await kindOf(client.exchangeCode('c'))).toBe('rejected')
  })
})

describe('refreshAccessToken', () => {
  it('skickar refresh_token-flödet och tolkar svaret', async () => {
    const { client, requests } = clientWith(() =>
      json({ access_token: 'new-access', expires_in: 3599, token_type: 'Bearer' }),
    )

    const result = await client.refreshAccessToken('the-refresh')

    expect(result).toEqual({ accessToken: 'new-access', expiresInSeconds: 3599 })
    expect(Object.fromEntries(requests[0]?.body ?? [])).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      grant_type: 'refresh_token',
      refresh_token: 'the-refresh',
    })
  })

  it('tolkar återkallad åtkomst som invalid_grant', async () => {
    const { client } = clientWith(() =>
      json(
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        400,
      ),
    )
    expect(await kindOf(client.refreshAccessToken('r'))).toBe('invalid_grant')
  })

  it('använder en annan token-endpoint när den anges (emulatorn)', async () => {
    const { fetchFn, requests } = createFetch(() => json({ access_token: 'a', expires_in: 60 }))
    const client = createGoogleOAuthClient({
      clientId: 'id',
      clientSecret: 'secret',
      tokenUrl: 'http://127.0.0.1:9999/token',
      fetchFn,
    })

    await client.refreshAccessToken('r')

    expect(requests[0]?.url).toBe('http://127.0.0.1:9999/token')
  })
})
