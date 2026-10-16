import { toRfc3339 } from '@/lib/dates'
import type { CalendarInfo, CalEvent } from '@/types'
import type { GoogleReader, RequestOptions } from './client'
import { GoogleAccessError, GoogleApiError } from './errors'
import { parseCalendarListPage, parseEventsPage, type ParseIssue } from './mappers'

/** Fler sidor än så här betraktas som ett fel hos oss eller Google, inte som en riktig kalender. */
const MAX_PAGES = 10
const CALENDAR_PAGE_SIZE = 250
const EVENT_PAGE_SIZE = 2500
const DEFAULT_CONCURRENCY = 4

const CALENDAR_LIST_FIELDS =
  'nextPageToken,items(id,summary,summaryOverride,backgroundColor,foregroundColor,selected,primary,deleted,accessRole,timeZone,defaultReminders)'
const EVENT_FIELDS =
  'nextPageToken,timeZone,items(id,etag,status,summary,location,description,reminders,start,end,recurringEventId,extendedProperties/private)'

export interface CalendarListResult {
  calendars: CalendarInfo[]
  issues: ParseIssue[]
}

/** Alla användarens kalendrar (alla sidor). Färgerna kommer som hex via colorRgbFormat. */
export async function listCalendars(
  client: GoogleReader,
  options: RequestOptions = {},
): Promise<CalendarListResult> {
  const calendars: CalendarInfo[] = []
  const issues: ParseIssue[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await client.getJson(
      '/users/me/calendarList',
      {
        colorRgbFormat: true,
        maxResults: CALENDAR_PAGE_SIZE,
        fields: CALENDAR_LIST_FIELDS,
        pageToken,
      },
      options,
    )
    const parsed = parseOrBadResponse(() => parseCalendarListPage(raw))
    calendars.push(...parsed.calendars)
    issues.push(...parsed.issues)
    if (parsed.nextPageToken === undefined) return { calendars, issues }
    pageToken = parsed.nextPageToken
  }
  throw new GoogleApiError('badResponse')
}

export interface EventsRequest {
  calendarId: string
  /** Början (inklusive) och slut (exklusive) på intervallet. */
  timeMin: Date
  timeMax: Date
  /** Användarens tidszon. Google skickar tider med den zonens offset. */
  timeZone: string
}

export interface EventsResult {
  events: CalEvent[]
  issues: ParseIssue[]
  /** Sant om det fanns fler händelser än vi hämtade (fler sidor än `MAX_PAGES`). */
  truncated: boolean
}

/**
 * Händelser i en kalender för ett intervall (alla sidor). Återkommande händelser kommer som
 * enskilda instanser (singleEvents=true). Vi expanderar aldrig RRULE själva.
 */
export async function listEvents(
  client: GoogleReader,
  request: EventsRequest,
  options: RequestOptions = {},
): Promise<EventsResult> {
  const events: CalEvent[] = []
  const issues: ParseIssue[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await client.getJson(
      `/calendars/${encodeURIComponent(request.calendarId)}/events`,
      {
        singleEvents: true,
        orderBy: 'startTime',
        timeMin: toRfc3339(request.timeMin, request.timeZone),
        timeMax: toRfc3339(request.timeMax, request.timeZone),
        timeZone: request.timeZone,
        maxResults: EVENT_PAGE_SIZE,
        fields: EVENT_FIELDS,
        pageToken,
      },
      options,
    )
    const parsed = parseOrBadResponse(() =>
      parseEventsPage(raw, { calendarId: request.calendarId, fallbackTimeZone: request.timeZone }),
    )
    events.push(...parsed.events)
    issues.push(...parsed.issues)
    if (parsed.nextPageToken === undefined) return { events, issues, truncated: false }
    pageToken = parsed.nextPageToken
  }
  return { events, issues, truncated: true }
}

export interface CalendarFailure {
  calendarId: string
  error: GoogleApiError
}

export interface MultiEventsRequest {
  calendars: readonly Pick<CalendarInfo, 'id' | 'timeZone'>[]
  timeMin: Date
  timeMax: Date
  timeZone: string
}

export interface MultiEventsResult {
  events: CalEvent[]
  issues: (ParseIssue & { calendarId: string })[]
  /** Kalendrar som inte gick att hämta. De övriga visas ändå. */
  failures: CalendarFailure[]
  truncatedCalendarIds: string[]
}

export interface MultiEventsOptions extends RequestOptions {
  /** Hur många kalendrar som hämtas samtidigt (standard 4), för att inte slå i Googles rate limit. */
  concurrency?: number
}

/**
 * Händelser från flera kalendrar. En kalender som misslyckas (t.ex. raderad eller utan åtkomst)
 * stoppar inte de andra: den hamnar i `failures`. Problem med själva åtkomsten (`GoogleAccessError`)
 * kastas direkt eftersom de drabbar alla kalendrar.
 */
export async function listEventsForCalendars(
  client: GoogleReader,
  request: MultiEventsRequest,
  { concurrency = DEFAULT_CONCURRENCY, signal }: MultiEventsOptions = {},
): Promise<MultiEventsResult> {
  const results = new Map<string, EventsResult | GoogleApiError>()
  const queue = [...request.calendars]
  let accessError: GoogleAccessError | undefined

  async function worker() {
    for (;;) {
      const calendar = queue.shift()
      if (!calendar || accessError) return
      try {
        const result = await listEvents(
          client,
          {
            calendarId: calendar.id,
            timeMin: request.timeMin,
            timeMax: request.timeMax,
            timeZone: calendar.timeZone ?? request.timeZone,
          },
          signal ? { signal } : {},
        )
        results.set(calendar.id, result)
      } catch (error) {
        if (error instanceof GoogleApiError) results.set(calendar.id, error)
        else if (error instanceof GoogleAccessError) accessError ??= error
        else throw error
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, () => worker()),
  )
  if (accessError) throw accessError

  const merged: MultiEventsResult = {
    events: [],
    issues: [],
    failures: [],
    truncatedCalendarIds: [],
  }
  // Behåll kalendrarnas ordning så att resultatet blir förutsägbart.
  for (const calendar of request.calendars) {
    const result = results.get(calendar.id)
    if (result === undefined) continue
    if (result instanceof GoogleApiError) {
      merged.failures.push({ calendarId: calendar.id, error: result })
      continue
    }
    merged.events.push(...result.events)
    merged.issues.push(...result.issues.map((issue) => ({ ...issue, calendarId: calendar.id })))
    if (result.truncated) merged.truncatedCalendarIds.push(calendar.id)
  }
  return merged
}

function parseOrBadResponse<T>(parse: () => T): T {
  try {
    return parse()
  } catch {
    throw new GoogleApiError('badResponse')
  }
}
