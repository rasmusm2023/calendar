import { describe, expect, it, vi } from 'vitest'
import { createGoogleClient, buildUrl } from './client'
import { GoogleAccessError, GoogleApiError, type GoogleApiErrorKind } from './errors'

const BASE = 'https://www.googleapis.com/calendar/v3'

type Step = Response | Error

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function googleError(status: number, reason: string, headers: Record<string, string> = {}) {
  return json({ error: { code: status, errors: [{ reason }] } }, status, headers)
}

interface Setup {
  steps: Step[]
  tokens?: string[]
  random?: () => number
  maxRetries?: number
}

function setup({ steps, tokens = ['token-1', 'token-2'], random = () => 1, maxRetries }: Setup) {
  const queue = [...steps]
  const tokenQueue = [...tokens]
  const requests: { url: string; authorization: string | null }[] = []
  const fetchFn = vi.fn<typeof fetch>((input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      authorization: new Headers(init?.headers).get('Authorization'),
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
  const getAccessToken = vi.fn(() => Promise.resolve(tokenQueue[0] ?? 'out-of-tokens'))
  const invalidateToken = vi.fn(() => {
    tokenQueue.shift()
  })
  const client = createGoogleClient({
    getAccessToken,
    invalidateToken,
    fetchFn,
    sleep,
    random,
    ...(maxRetries !== undefined && { maxRetries }),
  })
  return { client, requests, delays, fetchFn, sleep, getAccessToken, invalidateToken }
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Förväntade ett fel men anropet lyckades')
}

async function apiKindOf(promise: Promise<unknown>): Promise<GoogleApiErrorKind> {
  const error = await failureOf(promise)
  if (error instanceof GoogleApiError) return error.kind
  throw error as Error
}

describe('buildUrl', () => {
  it('lägger på parametrar och hoppar över odefinierade', () => {
    const url = new URL(
      buildUrl(BASE, '/users/me/calendarList', { a: 1, b: true, c: 'x y', d: undefined }),
    )
    expect(url.origin + url.pathname).toBe(`${BASE}/users/me/calendarList`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ a: '1', b: 'true', c: 'x y' })
  })
})

describe('createGoogleClient', () => {
  it('skickar Bearer-token och ger tillbaka svaret', async () => {
    const { client, requests } = setup({ steps: [json({ items: [] })] })

    const body = await client.getJson('/users/me/calendarList', { maxResults: 5 })

    expect(body).toEqual({ items: [] })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(`${BASE}/users/me/calendarList?maxResults=5`)
    expect(requests[0]?.authorization).toBe('Bearer token-1')
  })

  describe('401', () => {
    it('hämtar ny token och försöker en gång till direkt, utan väntetid', async () => {
      const { client, requests, sleep, invalidateToken } = setup({
        steps: [json({}, 401), json({ ok: true })],
      })

      expect(await client.getJson('/x')).toEqual({ ok: true })

      expect(invalidateToken).toHaveBeenCalledTimes(1)
      expect(requests.map((r) => r.authorization)).toEqual(['Bearer token-1', 'Bearer token-2'])
      expect(sleep).not.toHaveBeenCalled()
    })

    it('kastar GoogleAccessError när 401 består efter ny token', async () => {
      const { client, fetchFn } = setup({ steps: [json({}, 401), json({}, 401)] })

      const error = await failureOf(client.getJson('/x'))

      expect(error).toBeInstanceOf(GoogleAccessError)
      expect((error as GoogleAccessError).reason).toBe('access_revoked')
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('kastar vidare GoogleAccessError från token-hämtningen', async () => {
      const client = createGoogleClient({
        getAccessToken: () => Promise.reject(new GoogleAccessError('not_connected')),
        invalidateToken: () => undefined,
        fetchFn: () => Promise.reject(new Error('ska inte anropas')),
      })

      const error = await failureOf(client.getJson('/x'))

      expect((error as GoogleAccessError).reason).toBe('not_connected')
    })
  })

  describe('nya försök med väntetid', () => {
    it('väntar exponentiellt och lyckas till slut efter 5xx', async () => {
      const { client, delays, fetchFn } = setup({
        steps: [json({}, 503), json({}, 500), json({}, 502), json({ ok: true })],
      })

      expect(await client.getJson('/x')).toEqual({ ok: true })

      expect(fetchFn).toHaveBeenCalledTimes(4)
      expect(delays).toEqual([500, 1000, 2000])
    })

    it('lägger på jitter mellan 50 och 100 procent', async () => {
      const low = setup({ steps: [json({}, 500), json({ ok: true })], random: () => 0 })
      await low.client.getJson('/x')
      expect(low.delays).toEqual([250])

      const high = setup({ steps: [json({}, 500), json({ ok: true })], random: () => 1 })
      await high.client.getJson('/x')
      expect(high.delays).toEqual([500])
    })

    it('ger upp efter maxRetries och rapporterar serverfel', async () => {
      const { client, fetchFn, delays } = setup({
        steps: Array.from({ length: 5 }, () => json({}, 503)),
      })

      expect(await apiKindOf(client.getJson('/x'))).toBe('server')
      expect(fetchFn).toHaveBeenCalledTimes(5)
      expect(delays).toEqual([500, 1000, 2000, 4000])
    })

    it('tar aldrig längre väntetid än maxDelayMs', async () => {
      const delays: number[] = []
      const capped = createGoogleClient({
        getAccessToken: () => Promise.resolve('t'),
        invalidateToken: () => undefined,
        fetchFn: vi.fn<typeof fetch>(() => Promise.resolve(json({}, 503))),
        sleep: (ms) => {
          delays.push(ms)
          return Promise.resolve()
        },
        random: () => 1,
        baseDelayMs: 10_000,
        maxDelayMs: 15_000,
        maxRetries: 3,
      })

      await apiKindOf(capped.getJson('/x'))

      expect(delays).toEqual([10_000, 15_000, 15_000])
    })

    it('behandlar 429 som rate limit och följer Retry-After när den är längre', async () => {
      const { client, delays } = setup({
        steps: [json({}, 429, { 'Retry-After': '7' }), json({ ok: true })],
      })

      await client.getJson('/x')

      expect(delays).toEqual([7000])
    })

    it('ignorerar Retry-After som är kortare än vår egen väntetid', async () => {
      const { client, delays } = setup({
        steps: [json({}, 429, { 'Retry-After': '0' }), json({ ok: true })],
      })

      await client.getJson('/x')

      expect(delays).toEqual([500])
    })

    it.each(['rateLimitExceeded', 'userRateLimitExceeded'])(
      'väntar ut 403 med orsaken %s',
      async (reason) => {
        const { client, delays } = setup({ steps: [googleError(403, reason), json({ ok: true })] })

        expect(await client.getJson('/x')).toEqual({ ok: true })
        expect(delays).toEqual([500])
      },
    )

    it('rapporterar rateLimited om det fortfarande är för många anrop efter alla försök', async () => {
      const { client } = setup({
        steps: Array.from({ length: 3 }, () => googleError(403, 'rateLimitExceeded')),
        maxRetries: 2,
      })
      expect(await apiKindOf(client.getJson('/x'))).toBe('rateLimited')
    })

    it('försöker om vid nätverksfel och ger sedan upp som network', async () => {
      const ok = setup({ steps: [new TypeError('Failed to fetch'), json({ ok: true })] })
      expect(await ok.client.getJson('/x')).toEqual({ ok: true })
      expect(ok.delays).toEqual([500])

      const down = setup({
        steps: Array.from({ length: 5 }, () => new TypeError('Failed to fetch')),
      })
      expect(await apiKindOf(down.client.getJson('/x'))).toBe('network')
      expect(down.fetchFn).toHaveBeenCalledTimes(5)
    })
  })

  describe('fel som inte lönar sig att försöka om', () => {
    it.each<[number, string | undefined, GoogleApiErrorKind]>([
      [403, 'dailyLimitExceeded', 'quotaExceeded'],
      [403, 'quotaExceeded', 'quotaExceeded'],
      [403, 'forbiddenForNonOrganizer', 'forbidden'],
      [403, undefined, 'forbidden'],
      [404, 'notFound', 'notFound'],
      [410, 'deleted', 'gone'],
      [400, 'badRequest', 'badRequest'],
    ])('HTTP %i (%s) ger %s direkt', async (status, reason, kind) => {
      const response = reason ? googleError(status, reason) : json({}, status)
      const { client, fetchFn, sleep } = setup({ steps: [response] })

      expect(await apiKindOf(client.getJson('/x'))).toBe(kind)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })

    it('behåller HTTP-status på felet', async () => {
      const { client } = setup({ steps: [googleError(404, 'notFound')] })
      const error = await failureOf(client.getJson('/x'))
      expect((error as GoogleApiError).status).toBe(404)
    })
  })

  it('rapporterar ett lyckat svar som inte är JSON som badResponse', async () => {
    const { client } = setup({ steps: [new Response('<html></html>', { status: 200 })] })
    expect(await apiKindOf(client.getJson('/x'))).toBe('badResponse')
  })

  describe('avbrott', () => {
    it('gör inget anrop om signalen redan är avbruten', async () => {
      const { client, fetchFn } = setup({ steps: [json({})] })
      const controller = new AbortController()
      controller.abort()

      await expect(client.getJson('/x', {}, { signal: controller.signal })).rejects.toBeDefined()
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('försöker inte om ett avbrutet anrop', async () => {
      const controller = new AbortController()
      const abortError = new DOMException('Aborted', 'AbortError')
      const fetchFn = vi.fn<typeof fetch>(() => {
        controller.abort()
        return Promise.reject(abortError)
      })
      const sleep = vi.fn(() => Promise.resolve())
      const client = createGoogleClient({
        getAccessToken: () => Promise.resolve('t'),
        invalidateToken: () => undefined,
        fetchFn,
        sleep,
      })

      const error = await failureOf(client.getJson('/x', {}, { signal: controller.signal }))

      expect(error).toBe(abortError)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })
  })
})
