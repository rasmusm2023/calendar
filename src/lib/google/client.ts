import { GoogleAccessError, GoogleApiError } from './errors'

export const CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3'

export type QueryValue = string | number | boolean | undefined
export type QueryParams = Record<string, QueryValue>

export interface RequestOptions {
  /** Avbryter anropet och väntan mellan försök, t.ex. när TanStack Query avbryter en hämtning. */
  signal?: AbortSignal
}

/** GET mot Google Calendar API med token, nya försök och väntetid. Returnerar orörd JSON. */
export interface GoogleReader {
  getJson(path: string, params?: QueryParams, options?: RequestOptions): Promise<unknown>
}

export type WriteMethod = 'POST' | 'PATCH' | 'DELETE'

export interface WriteRequest extends RequestOptions {
  params?: QueryParams
  /** Skickas som JSON. */
  body?: unknown
  /** Skickas som If-Match. Google svarar 412 om händelsen ändrats sedan dess (PROJECT.md §5.3). */
  ifMatch?: string
  /** Tillåt tomt svar (204 No Content), t.ex. vid DELETE. Då returneras `undefined`. */
  allowEmpty?: boolean
}

/**
 * Läsande och skrivande anrop mot Google Calendar API. Skrivande anrop görs inte om efter nätverksfel
 * eller 5xx, eftersom Google kan ha hunnit utföra ändringen. Det som väntas ut är rate limit (429 och
 * 403 med rate limit-orsak), där anropet säkert inte utfördes. Den som anropar ansvarar för att göra
 * ändringen idempotent (se `insertEvent`) och för att ange `ifMatch`.
 */
export interface GoogleClient extends GoogleReader {
  requestJson(method: WriteMethod, path: string, request?: WriteRequest): Promise<unknown>
}

export interface GoogleClientOptions {
  /** Ger en giltig access token (hämtas och förnyas vid behov). */
  getAccessToken: () => Promise<string>
  /** Glöm cachad token. Anropas när Google svarar 401 så att nästa försök får en ny. */
  invalidateToken: () => void
  baseUrl?: string
  /** Antal nya försök efter första anropet vid tillfälliga fel (standard 4). */
  maxRetries?: number
  /** Första väntetiden i ms. Dubblas för varje försök (standard 500). */
  baseDelayMs?: number
  /** Längsta väntetid i ms, även om Google ber om längre (standard 30 000). */
  maxDelayMs?: number
  /** Högsta antal anrop mot Google samtidigt (standard 6). Övriga köas, så att många kalendrar inte slår i rate limit. */
  maxConcurrent?: number
  /** Byts ut i tester. */
  fetchFn?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

const DEFAULT_MAX_RETRIES = 4
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_MAX_CONCURRENT = 6

/** Googles rate limit-orsaker (403). Det är dessa som det lönar sig att vänta ut. */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded'])
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded', 'dailyLimitExceededUnreg'])

export function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** Plockar ut Googles felorsak (`error.errors[0].reason`) ur ett felsvar. */
function errorReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
  const error = body.error
  if (typeof error !== 'object' || error === null || !('errors' in error)) return undefined
  const errors = error.errors
  if (!Array.isArray(errors)) return undefined
  const first: unknown = errors[0]
  if (typeof first === 'object' && first !== null && 'reason' in first) {
    return typeof first.reason === 'string' ? first.reason : undefined
  }
  return undefined
}

/** Retry-After i sekunder. Datumformatet ignoreras, då gäller vår egen väntetid. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('Retry-After')
  if (header === null || !/^\d+$/.test(header)) return undefined
  return Number(header) * 1000
}

type Verdict =
  | { action: 'retry'; failure: GoogleApiError; retryAfterMs?: number }
  | { action: 'fail'; failure: GoogleApiError }

function judge(response: Response, body: unknown): Verdict {
  const { status } = response
  const retryAfter = retryAfterMs(response)
  const retry = (failure: GoogleApiError): Verdict => ({
    action: 'retry',
    failure,
    ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
  })

  if (status === 429) return retry(new GoogleApiError('rateLimited', status))
  if (status >= 500) return retry(new GoogleApiError('server', status))

  if (status === 403) {
    const reason = errorReason(body)
    if (reason !== undefined && RATE_LIMIT_REASONS.has(reason)) {
      return retry(new GoogleApiError('rateLimited', status))
    }
    if (reason !== undefined && QUOTA_REASONS.has(reason)) {
      return { action: 'fail', failure: new GoogleApiError('quotaExceeded', status) }
    }
    return { action: 'fail', failure: new GoogleApiError('forbidden', status) }
  }
  if (status === 404) return { action: 'fail', failure: new GoogleApiError('notFound', status) }
  if (status === 409) return { action: 'fail', failure: new GoogleApiError('conflict', status) }
  if (status === 410) return { action: 'fail', failure: new GoogleApiError('gone', status) }
  if (status === 412) {
    return { action: 'fail', failure: new GoogleApiError('preconditionFailed', status) }
  }
  return { action: 'fail', failure: new GoogleApiError('badRequest', status) }
}

export function createGoogleClient(options: GoogleClientOptions): GoogleClient {
  const {
    getAccessToken,
    invalidateToken,
    baseUrl = CALENDAR_API_BASE_URL,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    fetchFn = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  let active = 0
  const waiting: (() => void)[] = []

  /** Släpper in högst `maxConcurrent` anrop åt gången. Väntetid mellan försök håller inte någon plats. */
  async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve)
      })
    }
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }

  /** Exponentiell väntetid med jitter (50–100 % av värdet) så att många klienter inte synkar. */
  function backoffDelay(attempt: number, serverHintMs: number | undefined): number {
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
    const jittered = exponential * (0.5 + random() * 0.5)
    return Math.min(maxDelayMs, Math.max(jittered, serverHintMs ?? 0))
  }

  interface SendOptions {
    method: 'GET' | WriteMethod
    params?: QueryParams
    body?: unknown
    ifMatch?: string
    signal?: AbortSignal
    allowEmpty?: boolean
  }

  /**
   * Gemensam väg för alla anrop: token, 401-förnyelse, väntetid och felklassning. Läsning görs om vid
   * nätverksfel och 5xx. Skrivning görs inte om då, eftersom Google kan ha utfört ändringen. Rate limit
   * väntas ut för båda.
   */
  async function send(path: string, options: SendOptions): Promise<unknown> {
    const { method, params, body, ifMatch, signal, allowEmpty = false } = options
    const isRead = method === 'GET'
    const url = buildUrl(baseUrl, path, params)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (ifMatch !== undefined) headers['If-Match'] = ifMatch
    // Läsningar delar på gränsen för samtidiga anrop. Skrivningar köar inte bakom dem, så att en
    // ändring inte väntar på en lång rad hämtningar.
    const slot = isRead ? withSlot : <T>(task: () => Promise<T>) => task()

    let retries = 0
    let refreshedAfter401 = false

    for (;;) {
      signal?.throwIfAborted()
      const token = await getAccessToken()

      let response: Response
      try {
        response = await slot(() =>
          fetchFn(url, {
            method,
            headers: { ...headers, Authorization: `Bearer ${token}` },
            ...(body !== undefined && { body: JSON.stringify(body) }),
            ...(signal && { signal }),
          }),
        )
      } catch (error) {
        // Ett avbrutet anrop är inget fel hos Google och ska inte göras om.
        if (signal?.aborted) throw error
        if (!isRead || retries >= maxRetries) throw new GoogleApiError('network')
        await sleep(backoffDelay(retries, undefined), signal)
        retries += 1
        continue
      }

      if (response.ok) {
        const parsed = await readJson(response)
        if (parsed === undefined) {
          if (allowEmpty) return undefined
          throw new GoogleApiError('badResponse', response.status)
        }
        return parsed
      }

      if (response.status === 401) {
        // Token kan ha gått ut eller återkallats. Hämta en ny och försök en gång till direkt. Hjälper
        // inte det är åtkomsten borta och användaren måste koppla om.
        if (refreshedAfter401) throw new GoogleAccessError('access_revoked')
        refreshedAfter401 = true
        invalidateToken()
        continue
      }

      const verdict = judge(response, await readJson(response))
      if (verdict.action === 'fail' || retries >= maxRetries) throw verdict.failure
      if (!isRead && verdict.failure.kind === 'server') throw verdict.failure
      await sleep(backoffDelay(retries, verdict.retryAfterMs), signal)
      retries += 1
    }
  }

  return {
    getJson(path, params, { signal } = {}) {
      return send(path, { method: 'GET', ...(params && { params }), ...(signal && { signal }) })
    },
    requestJson(method, path, { params, body, ifMatch, signal, allowEmpty } = {}) {
      return send(path, {
        method,
        ...(params && { params }),
        ...(body !== undefined && { body }),
        ...(ifMatch !== undefined && { ifMatch }),
        ...(signal && { signal }),
        ...(allowEmpty !== undefined && { allowEmpty }),
      })
    },
  }
}
