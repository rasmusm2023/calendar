import type { APIRequestContext, Page, Route } from '@playwright/test'

const CONTROL = 'http://127.0.0.1:9778/__control'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

export interface FakeCalendar {
  id: string
  name: string
  /** Hex, som Google skickar med colorRgbFormat. */
  color: string
  selected?: boolean
  primary?: boolean
  /** Googles accessRole. Standard owner. 
eader ger en skrivskyddad kalender. */
  accessRole?: string
  /** Kalenderns standardpåminnelser (calendarList.defaultReminders). */
  defaultReminders?: FakeReminder[]
}

export interface FakeReminder {
  method: 'popup' | 'email'
  minutes: number
}

export interface FakeReminders {
  useDefault: boolean
  overrides?: FakeReminder[]
}

export interface FakeEvent {
  id: string
  title: string
  location?: string
  description?: string
  reminders?: FakeReminders
  /**
   * Satt = ett undantag från en serie (en ändrad eller borttagen förekomst), som hör till huvudhändelsen med det id:t.
   * Förekomsterna som inte ändrats finns inte som egna händelser: de räknas ut ur huvudhändelsen.
   */
  recurringEventId?: string
  /** Undantag: förekomstens ursprungliga starttid (som `start`). */
  originalStart?: string
  /** Undantag: förekomsten är borttagen. */
  cancelled?: boolean
  /**
   * Satt = huvudhändelse för en serie, t.ex. `['RRULE:FREQ=WEEKLY;BYDAY=WE']`. Visas som förekomster, aldrig
   * själv, och kan hämtas med GET. Stöder DAILY och WEEKLY (BYDAY), COUNT, UNTIL och EXDATE.
   */
  recurrence?: string[]
  /** Serier: tidszonen som tiderna räknas i. Standard Europe/Stockholm. */
  timeZone?: string
  /** RFC 3339 med offset, eller ett rent datum för heldagshändelser. */
  start: string
  end: string
  allDay?: boolean
}

/** Låtsas-Googles token-server (e2e/support/fakeGoogleServer.mjs): styr om åtkomsten är återkallad. */
export const fakeGoogle = {
  async reset(request: APIRequestContext) {
    await request.post(`${CONTROL}/reset`)
  },
  async revoke(request: APIRequestContext) {
    await request.post(`${CONTROL}/revoke`)
  },
  async restore(request: APIRequestContext) {
    await request.post(`${CONTROL}/restore`)
  },
}

/**
 * Ersätter Googles inloggningsskript (GIS) med ett som direkt svarar med en engångskod. Koden godtas av
 * låtsas-Googles token-server, så hela kedjan genom Cloud Functions-emulatorn körs på riktigt.
 */
export async function stubGoogleIdentityServices(page: Page) {
  await page.route(GIS_SCRIPT, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.google = {
          accounts: {
            oauth2: {
              initCodeClient(config) {
                return {
                  requestCode() {
                    setTimeout(() => config.callback({ code: 'e2e-code' }), 20)
                  },
                }
              },
            },
          },
        }
      `,
    }),
  )
}

export interface CalendarApiMock {
  calendars: FakeCalendar[]
  /** Händelser per kalender-id. Filtreras på timeMin/timeMax som hos Google. */
  events: Record<string, FakeEvent[]>
  /** Kalendrar vars händelser ger 403. */
  forbidden: Set<string>
  /** Svara 401 på alla anrop (återkallad åtkomst). */
  unauthorized: boolean
  /** Alla anrop som gjorts mot händelser. */
  eventRequests: { calendarId: string; timeMin: string; timeMax: string }[]
  /** Skrivande anrop (POST, PATCH, DELETE) mot händelser, i den ordning de kom. */
  writeRequests: { method: string; path: string; body: unknown; ifMatch?: string }[]
  /** Om satt svarar alla skrivande anrop med det här felet. */
  failWrites: { status: number; reason: string } | null
  /** Fördröjning i ms innan skrivande anrop besvaras. */
  writeDelayMs: number
  /** Versionsnummer per kalender/händelse. Ger etag, och ökar vid varje ändring som hos Google. */
  versions: Record<string, number>
}

interface PatchBody {
  summary?: string
  location?: string | null
  description?: string | null
  reminders?: FakeReminders
  recurrence?: string[]
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string }
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface InsertBody {
  id: string
  summary?: string
  location?: string
  description?: string
  reminders?: FakeReminders
  recurrence?: string[]
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string }
}

function versionOf(state: CalendarApiMock, calendarId: string, eventId: string): number {
  return state.versions[`${calendarId}/${eventId}`] ?? 1
}

/** Händelsen som Google skickar den (event resource). */
function toResource(event: FakeEvent, version: number) {
  return {
    id: event.id,
    etag: `"${event.id}-${String(version)}"`,
    summary: event.title,
    ...(event.location !== undefined && { location: event.location }),
    ...(event.description !== undefined && { description: event.description }),
    ...(event.reminders !== undefined && { reminders: event.reminders }),
    ...(event.recurringEventId !== undefined && { recurringEventId: event.recurringEventId }),
    ...(event.originalStart !== undefined && {
      originalStartTime: event.allDay
        ? { date: event.originalStart }
        : { dateTime: event.originalStart },
    }),
    ...(event.recurrence !== undefined && { recurrence: event.recurrence }),
    start: event.allDay
      ? { date: event.start }
      : {
          dateTime: event.start,
          ...(event.timeZone !== undefined && { timeZone: event.timeZone }),
        },
    end: event.allDay
      ? { date: event.end }
      : { dateTime: event.end, ...(event.timeZone !== undefined && { timeZone: event.timeZone }) },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const SERIES_ZONE = 'Europe/Stockholm'
const MAX_SERIES_DAYS = 800

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS)
}

function ruleParts(recurrence: readonly string[]): Map<string, string> {
  const parts = new Map<string, string>()
  const line = recurrence.find((candidate) => candidate.startsWith('RRULE:'))
  for (const part of (line?.slice('RRULE:'.length) ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0) parts.set(part.slice(0, at), part.slice(at + 1))
  }
  return parts
}

/** UNTIL som ögonblick: ett datum ("20261020") gäller till dess början, en UTC-tid exakt. */
function untilMs(until: string | undefined): number {
  if (until === undefined) return Infinity
  const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
  if (until.length === 8) return Date.parse(date)
  return Date.parse(`${date}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`)
}

/** Förekomstens tid på ett visst datum: huvudhändelsens klockslag och längd på den dagen. */
function occurrenceTime(master: FakeEvent, date: string): { start: string; end: string } {
  if (master.allDay)
    return { start: date, end: addDays(date, daysBetween(master.start, master.end)) }
  const zone = master.timeZone ?? SERIES_ZONE
  const at = (day: string, time: string) =>
    `${day}T${time}:00${offsetInZone(new Date(`${day}T${time}:00Z`), zone)}`
  const span = daysBetween(master.start.slice(0, 10), master.end.slice(0, 10))
  return {
    start: at(date, master.start.slice(11, 16)),
    end: at(addDays(date, span), master.end.slice(11, 16)),
  }
}

/**
 * Förekomsterna av en serie som överlappar [from, to), som Google ger dem med singleEvents=true. Undantag
 * (händelser med `recurringEventId`) ersätter sin förekomst, och borttagna visas bara med `includeCancelled`.
 */
function expandSeries(
  master: FakeEvent,
  all: readonly FakeEvent[],
  window: { from: number; to: number },
  includeCancelled = false,
): FakeEvent[] {
  const recurrence = master.recurrence ?? []
  const rule = ruleParts(recurrence)
  const count = rule.has('COUNT') ? Number(rule.get('COUNT')) : Infinity
  const until = untilMs(rule.get('UNTIL'))
  const excluded = new Set(
    recurrence
      .filter((line) => line.startsWith('EXDATE'))
      .flatMap((line) =>
        line
          .slice(line.indexOf(':') + 1)
          .split(',')
          .map((value) => value.slice(0, 8)),
      ),
  )
  const firstDate = master.start.slice(0, 10)
  const masterWeekday = WEEKDAYS[new Date(`${firstDate}T12:00:00Z`).getUTCDay()] ?? 'MO'
  const weekdays = rule.get('BYDAY')?.split(',') ?? [masterWeekday]
  const exceptions = all.filter((event) => event.recurringEventId === master.id)
  const result: FakeEvent[] = []
  let produced = 0

  for (let offset = 0; offset < MAX_SERIES_DAYS && produced < count; offset += 1) {
    const date = addDays(firstDate, offset)
    if (rule.get('FREQ') === 'WEEKLY') {
      const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? ''
      if (!weekdays.includes(weekday)) continue
    }
    const time = occurrenceTime(master, date)
    const startMs = Date.parse(time.start)
    if (startMs > until) break
    produced += 1
    if (startMs >= window.to) break
    if (excluded.has(date.replaceAll('-', ''))) continue

    const exception = exceptions.find((event) => Date.parse(event.originalStart ?? '') === startMs)
    const occurrence: FakeEvent = exception ?? {
      id: `${master.id}_${date.replaceAll('-', '')}`,
      title: master.title,
      ...(master.location !== undefined && { location: master.location }),
      ...(master.description !== undefined && { description: master.description }),
      ...(master.reminders !== undefined && { reminders: master.reminders }),
      recurringEventId: master.id,
      originalStart: time.start,
      start: time.start,
      end: time.end,
      allDay: master.allDay ?? false,
    }
    if (occurrence.cancelled === true && !includeCancelled) continue
    if (Date.parse(occurrence.start) < window.to && Date.parse(occurrence.end) > window.from) {
      result.push(occurrence)
    }
  }
  return result
}

/** Förekomsten med ett visst id, om id:t hör till en serie i kalendern och förekomsten finns. */
function findOccurrence(events: readonly FakeEvent[], eventId: string): FakeEvent | undefined {
  for (const master of events.filter((event) => event.recurrence !== undefined)) {
    if (!eventId.startsWith(`${master.id}_`)) continue
    const found = expandSeries(master, events, { from: 0, to: Infinity }).find(
      (occurrence) => occurrence.id === eventId,
    )
    if (found) return found
  }
  return undefined
}

function fromInsertBody(body: InsertBody): FakeEvent {
  const allDay = body.start.date !== undefined
  return {
    id: body.id,
    title: body.summary ?? '',
    ...(body.location !== undefined && { location: body.location }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.reminders !== undefined && { reminders: body.reminders }),
    ...(body.recurrence !== undefined && { recurrence: body.recurrence }),
    ...(body.start.timeZone !== undefined && { timeZone: body.start.timeZone }),
    start: body.start.date ?? body.start.dateTime ?? '',
    end: body.end.date ?? body.end.dateTime ?? '',
    allDay,
  }
}

function jsonError(route: Route, status: number, reason: string) {
  return route.fulfill({
    status,
    headers: CORS_HEADERS,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: status, message: reason, errors: [{ reason }] } }),
  })
}

/** Låtsas-Google Calendar API. Går att ändra under testets gång via det returnerade objektet. */
export async function mockCalendarApi(
  page: Page,
  initial: Pick<CalendarApiMock, 'calendars' | 'events'>,
): Promise<CalendarApiMock> {
  const state: CalendarApiMock = {
    ...initial,
    // Egen kopia: testet och mocken ändrar händelserna, och andra tester delar samma startdata.
    events: structuredClone(initial.events),
    forbidden: new Set(),
    unauthorized: false,
    eventRequests: [],
    writeRequests: [],
    failWrites: null,
    writeDelayMs: 0,
    versions: {},
  }

  await page.route(`${CALENDAR_API}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    if (state.unauthorized) {
      await jsonError(route, 401, 'authError')
      return
    }

    const url = new URL(request.url())
    const path = url.pathname.replace('/calendar/v3', '')

    if (path === '/users/me/calendarList') {
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({
          items: state.calendars.map((calendar) => ({
            id: calendar.id,
            summary: calendar.name,
            backgroundColor: calendar.color,
            accessRole: calendar.accessRole ?? 'owner',
            selected: calendar.selected ?? false,
            primary: calendar.primary ?? false,
            defaultReminders: calendar.defaultReminders ?? [],
          })),
        }),
      })
      return
    }

    const eventsMatch = /^\/calendars\/([^/]+)\/events$/.exec(path)
    const eventMatch = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path)
    const instancesMatch = /^\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/.exec(path)
    const method = request.method()

    if (eventMatch?.[1] && eventMatch[2] && method === 'GET') {
      const calendarId = decodeURIComponent(eventMatch[1])
      const eventId = decodeURIComponent(eventMatch[2])
      const list = state.events[calendarId] ?? []
      const found = list.find((event) => event.id === eventId) ?? findOccurrence(list, eventId)
      if (!found || found.cancelled === true) {
        await jsonError(route, 404, 'notFound')
        return
      }
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify(toResource(found, versionOf(state, calendarId, found.id))),
      })
      return
    }

    // Förekomsterna av en serie i ett intervall, med borttagna (showDeleted).
    if (instancesMatch?.[1] && instancesMatch[2] && method === 'GET') {
      const calendarId = decodeURIComponent(instancesMatch[1])
      const masterId = decodeURIComponent(instancesMatch[2])
      const list = state.events[calendarId] ?? []
      const master = list.find((event) => event.id === masterId)
      if (!master) {
        await jsonError(route, 404, 'notFound')
        return
      }
      const items = expandSeries(
        master,
        list,
        {
          from: Date.parse(url.searchParams.get('timeMin') ?? ''),
          to: Date.parse(url.searchParams.get('timeMax') ?? ''),
        },
        true,
      ).map((event) => ({ id: event.id }))
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      })
      return
    }

    if (eventsMatch?.[1] && method === 'GET') {
      const calendarId = decodeURIComponent(eventsMatch[1])
      const timeMin = url.searchParams.get('timeMin') ?? ''
      const timeMax = url.searchParams.get('timeMax') ?? ''
      state.eventRequests.push({ calendarId, timeMin, timeMax })
      if (state.forbidden.has(calendarId)) {
        await jsonError(route, 403, 'forbidden')
        return
      }
      const from = Date.parse(timeMin)
      const to = Date.parse(timeMax)
      const list = state.events[calendarId] ?? []
      const inWindow = (event: FakeEvent) =>
        Date.parse(event.start) < to && Date.parse(event.end) > from
      const masterIds = new Set(
        list.filter((event) => event.recurrence !== undefined).map((event) => event.id),
      )
      // Huvudhändelser och deras undantag visas som förekomster. Övrigt (även fristående "förekomster") som det är.
      const plain = list.filter(
        (event) =>
          event.recurrence === undefined &&
          !(event.recurringEventId !== undefined && masterIds.has(event.recurringEventId)) &&
          inWindow(event),
      )
      const occurrences = list
        .filter((event) => event.recurrence !== undefined)
        .flatMap((master) => expandSeries(master, list, { from, to }))
      const items = [...plain, ...occurrences].map((event) =>
        toResource(event, versionOf(state, calendarId, event.id)),
      )
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      })
      return
    }

    if (eventsMatch?.[1] && method === 'POST') {
      const calendarId = decodeURIComponent(eventsMatch[1])
      const body = request.postDataJSON() as InsertBody
      state.writeRequests.push({ method, path, body })
      if (state.failWrites) {
        await jsonError(route, state.failWrites.status, state.failWrites.reason)
        return
      }
      const event = fromInsertBody(body)
      const list = (state.events[calendarId] ??= [])
      if (list.some((existing) => existing.id === event.id)) {
        await jsonError(route, 409, 'duplicate')
        return
      }
      list.push(event)
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify(toResource(event, 1)),
      })
      return
    }

    if (eventMatch?.[1] && eventMatch[2] && method === 'PATCH') {
      const calendarId = decodeURIComponent(eventMatch[1])
      const eventId = decodeURIComponent(eventMatch[2])
      const body = request.postDataJSON() as PatchBody
      const ifMatch = (await request.headerValue('if-match')) ?? undefined
      state.writeRequests.push({ method, path, body, ...(ifMatch !== undefined && { ifMatch }) })
      if (state.writeDelayMs > 0) await delay(state.writeDelayMs)
      if (state.failWrites) {
        await jsonError(route, state.failWrites.status, state.failWrites.reason)
        return
      }
      const list = (state.events[calendarId] ??= [])
      let event = list.find((existing) => existing.id === eventId)
      if (!event) {
        // En ändring av en förekomst som ännu inte har något undantag: Google skapar ett.
        const occurrence = findOccurrence(list, eventId)
        if (occurrence) {
          list.push(occurrence)
          event = occurrence
        }
      }
      if (!event) {
        await jsonError(route, 404, 'notFound')
        return
      }
      const current = versionOf(state, calendarId, eventId)
      if (ifMatch !== undefined && ifMatch !== `"${eventId}-${String(current)}"`) {
        await jsonError(route, 412, 'conditionNotMet')
        return
      }
      if (body.summary !== undefined) event.title = body.summary
      // Som hos Google: `null` tar bort fältet.
      if (body.location !== undefined) {
        if (body.location === null) delete event.location
        else event.location = body.location
      }
      if (body.description !== undefined) {
        if (body.description === null) delete event.description
        else event.description = body.description
      }
      if (body.reminders !== undefined) event.reminders = body.reminders
      if (body.recurrence !== undefined) event.recurrence = body.recurrence
      if (body.start?.timeZone !== undefined) event.timeZone = body.start.timeZone
      if (body.start) {
        // Som hos Google: `null` rensar fältet, så att en händelse byter mellan heldag och tidsbestämd.
        event.allDay = body.start.date != null
        event.start = body.start.date ?? body.start.dateTime ?? event.start
      }
      if (body.end) event.end = body.end.date ?? body.end.dateTime ?? event.end
      state.versions[`${calendarId}/${eventId}`] = current + 1
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify(toResource(event, current + 1)),
      })
      return
    }
    if (eventMatch?.[1] && eventMatch[2] && method === 'DELETE') {
      const calendarId = decodeURIComponent(eventMatch[1])
      const eventId = decodeURIComponent(eventMatch[2])
      state.writeRequests.push({ method, path, body: undefined })
      if (state.failWrites) {
        await jsonError(route, state.failWrites.status, state.failWrites.reason)
        return
      }
      const list = (state.events[calendarId] ??= [])
      const stored = list.find((event) => event.id === eventId)
      if (stored?.recurringEventId !== undefined) {
        // Ett undantag tas bort genom att förekomsten markeras som borttagen.
        stored.cancelled = true
      } else if (stored === undefined) {
        const occurrence = findOccurrence(list, eventId)
        if (occurrence) list.push({ ...occurrence, cancelled: true })
      } else {
        // En huvudhändelse tar sina undantag med sig.
        state.events[calendarId] = list.filter(
          (event) => event.id !== eventId && event.recurringEventId !== eventId,
        )
      }
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    await jsonError(route, 404, 'notFound')
  })

  return state
}

/** "YYYY-MM-DD" för en dag i given tidszon. */
function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(instant)
}

/** Tidszonsoffset ("+02:00") för ett ögonblick. */
function offsetInZone(instant: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value
  const offset = part?.replace('GMT', '') ?? ''
  return offset === '' ? '+00:00' : offset
}

/** RFC 3339-tid för klockslaget `time` ("HH:mm") `daysFromToday` dagar från idag i given tidszon. */
export function zonedTime(daysFromToday: number, time: string, timeZone = 'Europe/Stockholm') {
  // Räkna på kalenderdatum (inte timmar) så att sommartidsbyte och sena kvällar inte flyttar dagen.
  const today = dateInZone(new Date(), timeZone)
  const shifted = new Date(`${today}T12:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + daysFromToday)
  const date = shifted.toISOString().slice(0, 10)
  const instant = new Date(`${date}T${time}:00Z`)
  return `${date}T${time}:00${offsetInZone(instant, timeZone)}`
}
