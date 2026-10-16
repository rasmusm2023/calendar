import { describe, expect, it, vi } from 'vitest'
import { createGoogleClient } from './client'
import { GoogleAccessError, GoogleApiError, type GoogleApiErrorKind } from './errors'

type Step = Response | Error

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

interface Recorded {
  url: string
  method: string | undefined
  body: string | undefined
  headers: Headers
}

function setup(steps: Step[], tokens = ['token-1', 'token-2']) {
  const queue = [...steps]
  const tokenQueue = [...tokens]
  const requests: Recorded[] = []
  const fetchFn = vi.fn<typeof fetch>((input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: new Headers(init?.headers),
    })
    const next = queue.shift()
    if (!next) return Promise.reject(new Error('fler anrop än väntat'))
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  const delays: number[] = []
  const sleep = vi.fn((ms: number) => {
    delays.push(ms)
    return Promise.resolve()
  })
  const client = createGoogleClient({
    getAccessToken: () => Promise.resolve(tokenQueue[0] ?? 'out-of-tokens'),
    invalidateToken: () => {
      tokenQueue.shift()
    },
    fetchFn,
    sleep,
    random: () => 1,
  })
  return { client, requests, delays, fetchFn }
}

async function kindOf(promise: Promise<unknown>): Promise<GoogleApiErrorKind> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GoogleApiError) return error.kind
    throw error
  }
  throw new Error('Förväntade ett fel men anropet lyckades')
}

describe('requestJson', () => {
  it('skickar metod, JSON-body, If-Match och token', async () => {
    const { client, requests } = setup([json({ id: 'e1' })])

    const result = await client.requestJson('PATCH', '/calendars/c/events/e1', {
      params: { fields: 'id' },
      body: { summary: 'Hej' },
      ifMatch: '"etag-1"',
    })

    expect(result).toEqual({ id: 'e1' })
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request?.method).toBe('PATCH')
    expect(request?.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/c/events/e1?fields=id',
    )
    expect(request?.body).toBe('{"summary":"Hej"}')
    expect(request?.headers.get('If-Match')).toBe('"etag-1"')
    expect(request?.headers.get('Content-Type')).toBe('application/json')
    expect(request?.headers.get('Authorization')).toBe('Bearer token-1')
  })

  it('skickar varken body, Content-Type eller If-Match när de inte angetts', async () => {
    const { client, requests } = setup([json({ id: 'e1' })])

    await client.requestJson('POST', '/calendars/c/events/e1/move')

    const [request] = requests
    expect(request?.body).toBeUndefined()
    expect(request?.headers.has('Content-Type')).toBe(false)
    expect(request?.headers.has('If-Match')).toBe(false)
  })

  it('ger undefined för ett tomt svar när allowEmpty är satt', async () => {
    const { client } = setup([new Response(null, { status: 204 })])

    await expect(
      client.requestJson('DELETE', '/calendars/c/events/e1', { allowEmpty: true }),
    ).resolves.toBeUndefined()
  })

  it('räknar ett tomt svar som fel när allowEmpty inte är satt', async () => {
    const { client } = setup([new Response(null, { status: 204 })])

    expect(await kindOf(client.requestJson('POST', '/x', { body: {} }))).toBe('badResponse')
  })

  it.each([
    [409, 'conflict'],
    [412, 'preconditionFailed'],
    [404, 'notFound'],
    [410, 'gone'],
    [400, 'badRequest'],
  ] as const)('klassar %i som %s och försöker inte igen', async (status, kind) => {
    const { client, fetchFn } = setup([json({}, status)])

    expect(await kindOf(client.requestJson('PATCH', '/x', { body: {} }))).toBe(kind)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  describe('nya försök för skrivande anrop', () => {
    it('gör inte om anropet vid 5xx, eftersom Google kan ha hunnit utföra ändringen', async () => {
      const { client, fetchFn, delays } = setup([json({}, 503), json({ id: 'e1' })])

      expect(await kindOf(client.requestJson('POST', '/x', { body: {} }))).toBe('server')
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(delays).toEqual([])
    })

    it('gör inte om anropet vid nätverksfel', async () => {
      const { client, fetchFn } = setup([new TypeError('Failed to fetch'), json({ id: 'e1' })])

      expect(await kindOf(client.requestJson('PATCH', '/x', { body: {} }))).toBe('network')
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('väntar ut rate limit (429) och försöker igen', async () => {
      const { client, fetchFn, delays } = setup([
        json({}, 429, { 'Retry-After': '2' }),
        json({ id: 'e1' }),
      ])

      await expect(client.requestJson('POST', '/x', { body: {} })).resolves.toEqual({ id: 'e1' })
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(delays).toEqual([2000])
    })

    it('väntar ut rate limit som kommer som 403 med rätt orsak', async () => {
      const { client, fetchFn } = setup([
        json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403),
        json({ id: 'e1' }),
      ])

      await client.requestJson('PATCH', '/x', { body: {} })
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('försöker 5xx igen för läsning, som tidigare', async () => {
      const { client, fetchFn } = setup([json({}, 503), json({ items: [] })])

      await client.getJson('/x')
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('401', () => {
    it('hämtar ny token och gör om skrivningen en gång', async () => {
      const { client, requests } = setup([json({}, 401), json({ id: 'e1' })])

      await client.requestJson('PATCH', '/x', { body: { a: 1 } })

      expect(requests.map((r) => r.headers.get('Authorization'))).toEqual([
        'Bearer token-1',
        'Bearer token-2',
      ])
      expect(requests[1]?.body).toBe('{"a":1}')
    })

    it('kastar GoogleAccessError när 401 består', async () => {
      const { client } = setup([json({}, 401), json({}, 401)])

      const promise = client.requestJson('DELETE', '/x', { allowEmpty: true })

      await expect(promise).rejects.toBeInstanceOf(GoogleAccessError)
    })
  })

  it('köar inte skrivningar bakom läsningar som fyller gränsen för samtidiga anrop', async () => {
    const releases: (() => void)[] = []
    const fetchFn = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === 'GET') {
        return new Promise<Response>((resolve) => {
          releases.push(() => {
            resolve(json({ ok: true }))
          })
        })
      }
      return Promise.resolve(json({ id: 'e1' }))
    })
    const client = createGoogleClient({
      getAccessToken: () => Promise.resolve('t'),
      invalidateToken: () => undefined,
      fetchFn,
      maxConcurrent: 1,
    })

    const reads = [client.getJson('/a'), client.getJson('/b')]
    const write = await client.requestJson('PATCH', '/x', { body: {} })

    expect(write).toEqual({ id: 'e1' })
    expect(releases).toHaveLength(1)
    releases[0]?.()
    await vi.waitFor(() => {
      expect(releases).toHaveLength(2)
    })
    releases[1]?.()
    await Promise.all(reads)
  })
})
