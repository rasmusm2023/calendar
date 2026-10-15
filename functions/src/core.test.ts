import { describe, expect, it } from 'vitest'
import { connectGoogle, getAccessToken } from './core'
import {
  CALENDAR_SCOPE,
  GoogleAccessError,
  OAuthError,
  type CodeExchangeResult,
  type Dependencies,
  type OAuthFailureKind,
  type RefreshResult,
  type StoredGoogleToken,
  type TokenStore,
} from './types'

const NOW = 1_800_000_000_000
const UID = 'user-1'

function createStore(initial: Record<string, StoredGoogleToken> = {}) {
  const data = new Map(Object.entries(initial))
  const store: TokenStore = {
    get: (uid) => Promise.resolve(data.get(uid) ?? null),
    save: (uid, token) => {
      data.set(uid, token)
      return Promise.resolve()
    },
    delete: (uid) => {
      data.delete(uid)
      return Promise.resolve()
    },
  }
  return { store, data }
}

interface OAuthScript {
  exchange?: CodeExchangeResult | OAuthFailureKind
  refresh?: RefreshResult | OAuthFailureKind
}

function createOAuth(script: OAuthScript) {
  const calls = { exchange: [] as string[], refresh: [] as string[] }
  const oauth: Dependencies['oauth'] = {
    exchangeCode: (code) => {
      calls.exchange.push(code)
      const result = script.exchange
      if (result === undefined) throw new Error('exchangeCode not scripted')
      return typeof result === 'string'
        ? Promise.reject(new OAuthError(result))
        : Promise.resolve(result)
    },
    refreshAccessToken: (refreshToken) => {
      calls.refresh.push(refreshToken)
      const result = script.refresh
      if (result === undefined) throw new Error('refreshAccessToken not scripted')
      return typeof result === 'string'
        ? Promise.reject(new OAuthError(result))
        : Promise.resolve(result)
    },
  }
  return { oauth, calls }
}

function deps(script: OAuthScript, initial: Record<string, StoredGoogleToken> = {}) {
  const { store, data } = createStore(initial)
  const { oauth, calls } = createOAuth(script)
  const dependencies: Dependencies = { store, oauth, now: () => NOW }
  return { dependencies, data, calls }
}

const goodExchange: CodeExchangeResult = {
  accessToken: 'access-1',
  expiresInSeconds: 3600,
  refreshToken: 'refresh-1',
  scope: `openid ${CALENDAR_SCOPE}`,
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GoogleAccessError) return error.reason
    throw error
  }
  throw new Error('Förväntade ett GoogleAccessError men anropet lyckades')
}

describe('connectGoogle', () => {
  it('sparar refresh token och returnerar access token utan att läcka refresh token', async () => {
    const { dependencies, data, calls } = deps({ exchange: goodExchange })

    const response = await connectGoogle(dependencies, UID, { code: 'code-1' })

    expect(calls.exchange).toEqual(['code-1'])
    expect(data.get(UID)).toEqual({
      refreshToken: 'refresh-1',
      scope: goodExchange.scope,
      connectedAt: NOW,
    })
    expect(response).toEqual({
      accessToken: 'access-1',
      expiresAt: NOW + 3_600_000,
      scope: goodExchange.scope,
    })
    expect(JSON.stringify(response)).not.toContain('refresh-1')
  })

  it.each([undefined, null, {}, { code: '' }, { code: 42 }, { code: 'x'.repeat(2049) }])(
    'avvisar ogiltig indata %j utan att anropa Google',
    async (input) => {
      const { dependencies, calls } = deps({ exchange: goodExchange })

      expect(await reasonOf(connectGoogle(dependencies, UID, input))).toBe('invalid_request')
      expect(calls.exchange).toHaveLength(0)
    },
  )

  it('avvisar och sparar ingenting när kalenderbehörighet saknas', async () => {
    const { dependencies, data } = deps({
      exchange: { ...goodExchange, scope: 'openid email' },
    })

    expect(await reasonOf(connectGoogle(dependencies, UID, { code: 'c' }))).toBe(
      'insufficient_scope',
    )
    expect(data.size).toBe(0)
  })

  it('matchar scope exakt och inte som delsträng', async () => {
    const { dependencies } = deps({
      exchange: { ...goodExchange, scope: `${CALENDAR_SCOPE}.readonly` },
    })

    expect(await reasonOf(connectGoogle(dependencies, UID, { code: 'c' }))).toBe(
      'insufficient_scope',
    )
  })

  it('behåller befintlig refresh token när Google inte skickar någon ny', async () => {
    const { dependencies, data } = deps(
      { exchange: { ...goodExchange, refreshToken: undefined } },
      { [UID]: { refreshToken: 'old-refresh', scope: 'old', connectedAt: 1 } },
    )

    await connectGoogle(dependencies, UID, { code: 'c' })

    expect(data.get(UID)).toEqual({
      refreshToken: 'old-refresh',
      scope: goodExchange.scope,
      connectedAt: NOW,
    })
  })

  it('ersätter befintlig refresh token när Google skickar en ny', async () => {
    const { dependencies, data } = deps(
      { exchange: goodExchange },
      { [UID]: { refreshToken: 'old-refresh', scope: 'old', connectedAt: 1 } },
    )

    await connectGoogle(dependencies, UID, { code: 'c' })

    expect(data.get(UID)?.refreshToken).toBe('refresh-1')
  })

  it('kräver nytt samtycke när varken Google eller vi har en refresh token', async () => {
    const { dependencies, data } = deps({
      exchange: { ...goodExchange, refreshToken: undefined },
    })

    expect(await reasonOf(connectGoogle(dependencies, UID, { code: 'c' }))).toBe('no_refresh_token')
    expect(data.size).toBe(0)
  })

  it('rör inte andra användares token', async () => {
    const other: StoredGoogleToken = { refreshToken: 'other', scope: 's', connectedAt: 1 }
    const { dependencies, data } = deps({ exchange: goodExchange }, { other })

    await connectGoogle(dependencies, UID, { code: 'c' })

    expect(data.get('other')).toBe(other)
  })

  it('översätter en förbrukad eller ogiltig kod', async () => {
    const { dependencies } = deps({ exchange: 'invalid_grant' })
    expect(await reasonOf(connectGoogle(dependencies, UID, { code: 'c' }))).toBe(
      'code_exchange_failed',
    )
  })

  it('översätter att Google är otillgängligt', async () => {
    const { dependencies } = deps({ exchange: 'unavailable' })
    expect(await reasonOf(connectGoogle(dependencies, UID, { code: 'c' }))).toBe(
      'google_unavailable',
    )
  })

  it('släpper igenom konfigurationsfel som interna fel', async () => {
    const { dependencies } = deps({ exchange: 'rejected' })
    await expect(connectGoogle(dependencies, UID, { code: 'c' })).rejects.toBeInstanceOf(OAuthError)
  })
})

describe('getAccessToken', () => {
  const stored: StoredGoogleToken = { refreshToken: 'refresh-1', scope: 's', connectedAt: 1 }

  it('hämtar en ny access token med den sparade refresh token', async () => {
    const { dependencies, calls } = deps(
      { refresh: { accessToken: 'access-2', expiresInSeconds: 1800 } },
      { [UID]: stored },
    )

    const response = await getAccessToken(dependencies, UID)

    expect(calls.refresh).toEqual(['refresh-1'])
    expect(response).toEqual({ accessToken: 'access-2', expiresAt: NOW + 1_800_000 })
  })

  it('använder bara den inloggade användarens token', async () => {
    const { dependencies, calls } = deps(
      { refresh: { accessToken: 'a', expiresInSeconds: 60 } },
      { [UID]: stored, other: { ...stored, refreshToken: 'other-refresh' } },
    )

    await getAccessToken(dependencies, 'other')

    expect(calls.refresh).toEqual(['other-refresh'])
  })

  it('svarar not_connected när ingen koppling finns', async () => {
    const { dependencies, calls } = deps({})
    expect(await reasonOf(getAccessToken(dependencies, UID))).toBe('not_connected')
    expect(calls.refresh).toHaveLength(0)
  })

  it('svarar access_revoked och tar bort token när Google säger invalid_grant', async () => {
    const { dependencies, data } = deps({ refresh: 'invalid_grant' }, { [UID]: stored })

    expect(await reasonOf(getAccessToken(dependencies, UID))).toBe('access_revoked')
    expect(data.has(UID)).toBe(false)
  })

  it('behåller token när Google bara är otillgängligt', async () => {
    const { dependencies, data } = deps({ refresh: 'unavailable' }, { [UID]: stored })

    expect(await reasonOf(getAccessToken(dependencies, UID))).toBe('google_unavailable')
    expect(data.get(UID)).toBe(stored)
  })

  it('behåller token och släpper igenom konfigurationsfel', async () => {
    const { dependencies, data } = deps({ refresh: 'rejected' }, { [UID]: stored })

    await expect(getAccessToken(dependencies, UID)).rejects.toBeInstanceOf(OAuthError)
    expect(data.get(UID)).toBe(stored)
  })
})
