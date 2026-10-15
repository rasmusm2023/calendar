import { FirebaseError } from 'firebase/app'
import { describe, expect, it, vi } from 'vitest'
import { GoogleAccessError, type GoogleAccessReason } from '@/lib/google'
import {
  createGoogleFunctionsClient,
  mapCallableError,
  type CallableTransport,
} from './googleFunctions'

function functionsError(code: string, details?: unknown): FirebaseError {
  const error = new FirebaseError(code, 'message')
  Object.assign(error, { details })
  return error
}

function clientReturning(result: unknown) {
  const call = vi.fn<CallableTransport['call']>(() => Promise.resolve(result))
  return { client: createGoogleFunctionsClient({ call }), call }
}

function clientFailingWith(error: Error) {
  const call = vi.fn<CallableTransport['call']>(() => Promise.reject(error))
  return createGoogleFunctionsClient({ call })
}

async function reasonOf(promise: Promise<unknown>): Promise<GoogleAccessReason> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GoogleAccessError) return error.reason
    throw error
  }
  throw new Error('Förväntade ett GoogleAccessError men anropet lyckades')
}

describe('mapCallableError', () => {
  it.each([
    'invalid_request',
    'code_exchange_failed',
    'insufficient_scope',
    'no_refresh_token',
    'not_connected',
    'access_revoked',
    'google_unavailable',
  ] as const)('läser orsaken %s från error.details.reason', (reason) => {
    const error = functionsError('functions/failed-precondition', { reason })
    expect(mapCallableError(error).reason).toBe(reason)
  })

  it('ignorerar okända orsaker i details', () => {
    const error = functionsError('functions/failed-precondition', { reason: 'something-new' })
    expect(mapCallableError(error).reason).toBe('unknown')
  })

  it('tolkar saknad inloggning', () => {
    expect(mapCallableError(functionsError('functions/unauthenticated')).reason).toBe(
      'unauthenticated',
    )
  })

  it.each(['functions/unavailable', 'functions/deadline-exceeded'])(
    'tolkar %s som tillfälligt fel',
    (code) => {
      expect(mapCallableError(functionsError(code)).reason).toBe('google_unavailable')
    },
  )

  it('ger unknown för allt annat, även vanliga fel', () => {
    expect(mapCallableError(functionsError('functions/internal')).reason).toBe('unknown')
    expect(mapCallableError(new Error('boom')).reason).toBe('unknown')
    expect(mapCallableError('text').reason).toBe('unknown')
  })

  it('lämnar redan tolkade fel orörda', () => {
    const error = new GoogleAccessError('not_connected')
    expect(mapCallableError(error)).toBe(error)
  })
})

describe('createGoogleFunctionsClient', () => {
  it('skickar koden till googleConnect och validerar svaret', async () => {
    const { client, call } = clientReturning({
      accessToken: 'access',
      expiresAt: 1_800_000_000_000,
      scope: 'calendar',
    })

    const result = await client.connect('the-code')

    expect(call).toHaveBeenCalledWith('googleConnect', { code: 'the-code' })
    expect(result).toEqual({
      accessToken: 'access',
      expiresAt: 1_800_000_000_000,
      scope: 'calendar',
    })
  })

  it('anropar googleAccessToken utan indata', async () => {
    const { client, call } = clientReturning({
      accessToken: 'access',
      expiresAt: 1_800_000_000_000,
    })

    expect(await client.fetchAccessToken()).toEqual({
      accessToken: 'access',
      expiresAt: 1_800_000_000_000,
    })
    expect(call).toHaveBeenCalledWith('googleAccessToken', {})
  })

  it.each([undefined, null, {}, { accessToken: '', expiresAt: 1 }, { accessToken: 'a' }])(
    'avvisar ett svar med fel form %j',
    async (response) => {
      const { client } = clientReturning(response)
      expect(await reasonOf(client.fetchAccessToken())).toBe('unknown')
    },
  )

  it('översätter fel från servern', async () => {
    const client = clientFailingWith(
      functionsError('functions/failed-precondition', { reason: 'access_revoked' }),
    )
    expect(await reasonOf(client.fetchAccessToken())).toBe('access_revoked')
    expect(await reasonOf(client.connect('c'))).toBe('access_revoked')
  })
})
