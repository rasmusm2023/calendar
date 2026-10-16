import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { parseIsoInZone } from '@/lib/dates'
import type { EventsResult } from '@/lib/google'
import type { CalEvent } from '@/types'
import { queryKeys } from './queryKeys'

/**
 * Ändringar i cachen för händelser, för optimistiska uppdateringar (PROJECT.md §5.3). Cachen har en post
 * per kalender och intervall (`queryKeys.eventsInRange`). En händelse läggs bara in i de poster vars
 * intervall den överlappar, och tas bort ur alla poster för kalendern.
 */

interface CachedRange {
  start: number
  end: number
  timeZone: string
}

/** Intervallet som en cache-nyckel `['events', calendarId, start, end, timeZone]` gäller. */
function rangeOfKey(key: QueryKey): CachedRange | null {
  const [, , start, end, timeZone] = key
  if (typeof start !== 'string' || typeof end !== 'string' || typeof timeZone !== 'string') {
    return null
  }
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  return { start: startMs, end: endMs, timeZone }
}

function overlaps(event: CalEvent, range: CachedRange): boolean {
  try {
    const start = parseIsoInZone(event.start, range.timeZone).getTime()
    const end = parseIsoInZone(event.end, range.timeZone).getTime()
    // En händelse utan längd (start = slut) räknas som att den finns vid sin starttid.
    return start < range.end && Math.max(end, start + 1) > range.start
  } catch {
    return false
  }
}

function entriesFor(queryClient: QueryClient, calendarId: string) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: [...queryKeys.events, calendarId] })
    .map((query) => ({ key: query.queryKey, range: rangeOfKey(query.queryKey) }))
}

/**
 * Lägger in händelsen i de cachade intervall den hör hemma i. Finns den redan (samma id) ersätts den,
 * så att anropet är säkert att göra om.
 */
export function addEventToCache(queryClient: QueryClient, event: CalEvent): void {
  for (const { key, range } of entriesFor(queryClient, event.calendarId)) {
    if (range === null) continue
    queryClient.setQueryData<EventsResult>(key, (data) => {
      if (data === undefined) return undefined
      const others = data.events.filter((existing) => existing.id !== event.id)
      return overlaps(event, range)
        ? { ...data, events: [...others, event] }
        : others.length === data.events.length
          ? data
          : { ...data, events: others }
    })
  }
}

/** Händelsen som den ligger i cachen just nu (med optimistiska ändringar), eller `undefined` om den inte finns där. */
export function findEventInCache(
  queryClient: QueryClient,
  ref: { calendarId: string; eventId: string },
): CalEvent | undefined {
  for (const { key } of entriesFor(queryClient, ref.calendarId)) {
    const found = queryClient
      .getQueryData<EventsResult>(key)
      ?.events.find((event) => event.id === ref.eventId)
    if (found) return found
  }
  return undefined
}

/**
 * Ändrar fält på en händelse som redan finns i cachen. Händelsen flyttas mellan intervall om tiden
 * ändras. Finns den inte i cachen görs ingenting.
 */
export function updateEventInCache(
  queryClient: QueryClient,
  ref: { calendarId: string; eventId: string },
  changes: Partial<Omit<CalEvent, 'id' | 'calendarId'>>,
): void {
  const current = findEventInCache(queryClient, ref)
  if (current === undefined) return
  addEventToCache(queryClient, { ...current, ...changes })
}

/** Tar bort händelsen ur alla cachade intervall för kalendern. */
export function removeEventFromCache(
  queryClient: QueryClient,
  ref: { calendarId: string; eventId: string },
): void {
  for (const { key } of entriesFor(queryClient, ref.calendarId)) {
    queryClient.setQueryData<EventsResult>(key, (data) => {
      if (data === undefined) return undefined
      const events = data.events.filter((existing) => existing.id !== ref.eventId)
      return events.length === data.events.length ? data : { ...data, events }
    })
  }
}

/**
 * Hämtar om en kalenders händelser från Google. Anropas efter en lyckad (eller återställd) skrivning, så att
 * det vi visar till sist är det Google har. Pågående hämtningar avbryts inte här: det görs före ändringen
 * (`cancelEventQueries`).
 */
export function refreshCalendarEvents(queryClient: QueryClient, calendarId: string): void {
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.events, calendarId] })
}

/**
 * Avbryter pågående hämtningar av kalenderns händelser och återställer dem till läget före. Görs innan en
 * optimistisk ändring, så att ett svar som var på väg (t.ex. från pollingen) inte skriver över den
 * med gamla data.
 */
export function cancelEventQueries(queryClient: QueryClient, calendarId: string): void {
  void queryClient.cancelQueries({ queryKey: [...queryKeys.events, calendarId] })
}
