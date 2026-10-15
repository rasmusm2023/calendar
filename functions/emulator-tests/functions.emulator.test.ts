import type { Server } from 'node:http'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeGoogle } from './fakeGoogle'

const PROJECT_ID = 'demo-spaces-calendar-fn'
const REGION = 'europe-west3'
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FIRESTORE_REST = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`

interface TestUser {
  uid: string
  idToken: string
}

interface CallableResult {
  status: number
  result?: Record<string, unknown>
  error?: { status: string; message: string; details?: { reason?: string } }
}

let fakeGoogle: Server
let counter = 0

async function createUser(): Promise<TestUser> {
  counter += 1
  const response = await fetch(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `user-${Date.now().toString()}-${counter.toString()}@example.com`,
      password: 'password123',
      returnSecureToken: true,
    }),
  })
  const body = (await response.json()) as { localId: string; idToken: string }
  return { uid: body.localId, idToken: body.idToken }
}

async function call(
  name: string,
  data: unknown,
  user: TestUser | undefined,
): Promise<CallableResult> {
  const response = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  })
  return { status: response.status, ...((await response.json()) as object) }
}

beforeAll(async () => {
  fakeGoogle = await startFakeGoogle()
  initializeApp({ projectId: PROJECT_ID })
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    fakeGoogle.close(() => {
      resolve()
    })
  })
})

function privateDoc(uid: string) {
  return getFirestore().doc(`users/${uid}/private/google`)
}

describe('googleConnect och googleAccessToken i emulatorn', () => {
  it('kräver inloggning', async () => {
    const connect = await call('googleConnect', { code: 'good-code' }, undefined)
    expect(connect.status).toBe(401)
    expect(connect.error?.status).toBe('UNAUTHENTICATED')

    const token = await call('googleAccessToken', {}, undefined)
    expect(token.status).toBe(401)
  })

  it('kopplar, sparar refresh token på servern och delar ut access tokens', async () => {
    const user = await createUser()

    const connect = await call('googleConnect', { code: 'good-code' }, user)
    expect(connect.status).toBe(200)
    expect(connect.result).toMatchObject({
      accessToken: 'fake-access-from-code',
      scope: expect.stringContaining('auth/calendar') as unknown,
    })
    expect(JSON.stringify(connect)).not.toContain('refresh-good')

    const stored = await privateDoc(user.uid).get()
    expect(stored.data()).toMatchObject({ refreshToken: 'refresh-good' })

    const before = Date.now()
    const token = await call('googleAccessToken', {}, user)
    expect(token.status).toBe(200)
    expect(token.result?.accessToken).toBe('fake-access-from-refresh')
    expect(token.result?.expiresAt).toBeGreaterThan(before + 3_000_000)
    expect(JSON.stringify(token)).not.toContain('refresh-good')
  })

  it('ger inte klienten tillgång till private/google, inte ens ägaren', async () => {
    const user = await createUser()
    await call('googleConnect', { code: 'good-code' }, user)

    const read = await fetch(`${FIRESTORE_REST}/users/${user.uid}/private/google`, {
      headers: { Authorization: `Bearer ${user.idToken}` },
    })
    expect(read.status).toBe(403)
  })

  it('svarar not_connected innan Google är kopplat', async () => {
    const user = await createUser()

    const token = await call('googleAccessToken', {}, user)

    expect(token.status).toBe(400)
    expect(token.error?.status).toBe('FAILED_PRECONDITION')
    expect(token.error?.details?.reason).toBe('not_connected')
  })

  it('svarar access_revoked och rensar token när Google återkallat åtkomsten', async () => {
    const user = await createUser()
    await call('googleConnect', { code: 'revoked-code' }, user)
    expect((await privateDoc(user.uid).get()).exists).toBe(true)

    const token = await call('googleAccessToken', {}, user)

    expect(token.error?.details?.reason).toBe('access_revoked')
    expect((await privateDoc(user.uid).get()).exists).toBe(false)
  })

  it.each([
    ['invalid_request', {}],
    ['code_exchange_failed', { code: 'used-or-bad-code' }],
    ['insufficient_scope', { code: 'no-calendar-code' }],
    ['no_refresh_token', { code: 'no-refresh-code' }],
  ])('svarar %s vid felaktig koppling och sparar ingenting', async (reason, data) => {
    const user = await createUser()

    const connect = await call('googleConnect', data, user)

    expect(connect.error?.details?.reason).toBe(reason)
    expect((await privateDoc(user.uid).get()).exists).toBe(false)
  })

  it('behåller refresh token vid ny koppling där Google inte skickar någon ny', async () => {
    const user = await createUser()
    await call('googleConnect', { code: 'good-code' }, user)

    const again = await call('googleConnect', { code: 'no-refresh-code' }, user)

    expect(again.status).toBe(200)
    expect((await privateDoc(user.uid).get()).data()).toMatchObject({
      refreshToken: 'refresh-good',
    })
  })

  it('håller användares tokens isär', async () => {
    const first = await createUser()
    const second = await createUser()
    await call('googleConnect', { code: 'good-code' }, first)

    const token = await call('googleAccessToken', {}, second)

    expect(token.error?.details?.reason).toBe('not_connected')
  })
})
