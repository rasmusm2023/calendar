import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import type { EventsResult, GoogleClient } from '@/lib/google'
import type { CalEvent } from '@/types'
import { queryKeys } from '@/features/events'

/**
 * Ett litet minnes-Google för tester av serie-kommandon: huvudhändelser som kan hämtas, ändras, skapas och tas
 * bort, och ett antal förekomster att svara med när antalet förekomster efterfrågas. Alla skrivande anrop loggas.
 */

export const TZ = 'Europe/Stockholm'
export const CAL = 'cal'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
export const WEEK_KEY = queryKeys.eventsInRange(
  CAL,
  toRfc3339(WEEK.start, TZ),
  toRfc3339(WEEK.end, TZ),
  TZ,
)

export type Raw = Record<string, unknown>

export interface SeriesCall {
  method: string
  path: string
  params?: Record<string, unknown> | undefined
  body?: Raw
  ifMatch?: string
}

/** Huvudhändelse för en serie som börjar onsdag 14 oktober 09:00–10:00. */
export function rawMaster(recurrence: string[], extra: Raw = {}): Raw {
  return {
    id: 'm1',
    etag: '"m1-1"',
    summary: 'Veckomöte',
    location: 'Rum 4',
    start: { dateTime: '2026-10-14T09:00:00+02:00', timeZone: TZ },
    end: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: TZ },
    recurrence,
    ...extra,
  }
}

/** En vanlig händelse, utan koppling till någon serie. */
export function standalone(day: number): CalEvent {
  const plain = instance(day)
  delete plain.recurringEventId
  delete plain.originalStart
  return plain
}

/** Förekomst av serien `m1` ett visst datum (oktober 2026, sommartid till och med 24:e). */
export function instance(day: number, extra: Partial<CalEvent> = {}): CalEvent {
  const date = `2026-10-${String(day).padStart(2, '0')}`
  const offset = day >= 25 ? '+01:00' : '+02:00'
  return {
    id: `m1_202610${String(day).padStart(2, '0')}`,
    calendarId: CAL,
    etag: `"i${String(day)}"`,
    title: 'Veckomöte',
    start: `${date}T09:00:00${offset}`,
    end: `${date}T10:00:00${offset}`,
    allDay: false,
    location: 'Rum 4',
    recurringEventId: 'm1',
    originalStart: `${date}T09:00:00${offset}`,
    important: false,
    ...extra,
  }
}

function merge(target: unknown, patch: unknown): unknown {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch
  const base: Raw = typeof target === 'object' && target !== null ? { ...target } : {}
  const result = new Map<string, unknown>(Object.entries(base))
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) result.delete(key)
    else result.set(key, merge(result.get(key), value))
  }
  return Object.fromEntries(result)
}

export interface FakeSeriesOptions {
  masters: Raw[]
  /** Förekomster i cachen. */
  cached: CalEvent[]
  /** Antal förekomster som `/instances` svarar med. */
  instanceCount?: number
  /** Ger ett fel för anropet, eller `undefined` om det ska gå bra. */
  fail?: (call: SeriesCall) => Error | undefined
}

export function setupSeries(options: FakeSeriesOptions) {
  const masters = new Map(options.masters.map((master) => [String(master.id), master]))
  const calls: SeriesCall[] = []

  const idOf = (path: string) => decodeURIComponent(path.split('/events/')[1]?.split('/')[0] ?? '')

  const getJson = vi.fn((path: string, params?: Record<string, unknown>) => {
    calls.push({ method: 'GET', path, params })
    const failure = options.fail?.({ method: 'GET', path, params })
    if (failure) return Promise.reject(failure)
    if (path.endsWith('/instances')) {
      const items = Array.from({ length: options.instanceCount ?? 0 }, (_, index) => ({
        id: `i${String(index)}`,
      }))
      return Promise.resolve({ items })
    }
    const master = masters.get(idOf(path))
    return master === undefined ? Promise.reject(new Error('404')) : Promise.resolve(master)
  })

  const requestJson = vi.fn(
    (method: string, path: string, request?: { body?: Raw; ifMatch?: string }) => {
      const call: SeriesCall = {
        method,
        path,
        ...(request?.body !== undefined && { body: request.body }),
        ...(request?.ifMatch !== undefined && { ifMatch: request.ifMatch }),
      }
      calls.push(call)
      const failure = options.fail?.(call)
      if (failure) return Promise.reject(failure)
      if (method === 'POST') {
        const body: Raw = { ...request?.body, etag: `"server-${String(request?.body?.id)}"` }
        masters.set(String(body.id), body)
        return Promise.resolve(body)
      }
      const id = idOf(path)
      if (method === 'DELETE') {
        masters.delete(id)
        return Promise.resolve(undefined)
      }
      const merged = merge(masters.get(id), request?.body) as Raw
      masters.set(id, merged)
      return Promise.resolve(merged)
    },
  )

  const client = { getJson, requestJson } as unknown as GoogleClient
  const queryClient = new QueryClient()
  queryClient.setQueryData<EventsResult>(WEEK_KEY, {
    events: options.cached,
    issues: [],
    truncated: false,
  })
  const cached = () => queryClient.getQueryData<EventsResult>(WEEK_KEY)?.events ?? []
  const byDay = () =>
    cached()
      .toSorted((a, b) => a.start.localeCompare(b.start))
      .map((event) => `${event.start.slice(5, 16)} ${event.title}`)
  const writes = () => calls.filter((call) => call.method !== 'GET')

  let counter = 0
  const newId = () => {
    counter += 1
    return `new${String(counter)}`
  }

  return { client, queryClient, calls, writes, masters, cached, byDay, newId }
}
