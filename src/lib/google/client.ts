import { GoogleAccessError, GoogleApiError } from './errors'

export const CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3'

export type QueryValue = string | number | boolean | undefined
export type QueryParams = Record<string, QueryValue>

export interface RequestOptions {
  /** Avbryter anropet och väntan mellan försök, t.ex. när TanStack Query avbryter en hämtning. */
  signal?: AbortSignal
}

/** GET mot Google Calendar API med token, nya försök och väntetid. Returnerar orörd JSON. */
export interface GoogleClient {
  getJson(path: string, params?: QueryParams, options?: RequestOptions): Promise<unknown>
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
  /** Byts ut i tester. */
  fetchFn?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

const DEFAULT_MAX_RETRIES = 4
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 30_000

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
  if (status === 410) return { action: 'fail', failure: new GoogleApiError('gone', status) }
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
    fetchFn = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  /** Exponentiell väntetid med jitter (50–100 % av värdet) så att många klienter inte synkar. */
  function backoffDelay(attempt: number, serverHintMs: number | undefined): number {
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
    const jittered = exponential * (0.5 + random() * 0.5)
    return Math.min(maxDelayMs, Math.max(jittered, serverHintMs ?? 0))
  }

  return {
    async getJson(path, params, { signal } = {}) {
      const url = buildUrl(baseUrl, path, params)
      let retries = 0
      let refreshedAfter401 = false

      for (;;) {
        signal?.throwIfAborted()
        const token = await getAccessToken()

        let response: Response
        try {
          response = await fetchFn(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            ...(signal && { signal }),
          })
        } catch (error) {
          // Ett avbrutet anrop är inget fel hos Google och ska inte göras om.
          if (signal?.aborted) throw error
          if (retries >= maxRetries) throw new GoogleApiError('network')
          await sleep(backoffDelay(retries, undefined), signal)
          retries += 1
          continue
        }

        if (response.ok) {
          const body = await readJson(response)
          if (body === undefined) throw new GoogleApiError('badResponse', response.status)
          return body
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
        await sleep(backoffDelay(retries, verdict.retryAfterMs), signal)
        retries += 1
      }
    },
  }
}
