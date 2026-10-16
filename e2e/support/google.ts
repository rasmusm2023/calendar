import type { APIRequestContext, Page, Route } from '@playwright/test'

const CONTROL = 'http://127.0.0.1:9778/__control'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
}

export interface FakeCalendar {
  id: string
  name: string
  /** Hex, som Google skickar med colorRgbFormat. */
  color: string
  selected?: boolean
  primary?: boolean
}

export interface FakeEvent {
  id: string
  title: string
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
    forbidden: new Set(),
    unauthorized: false,
    eventRequests: [],
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
            accessRole: 'owner',
            selected: calendar.selected ?? false,
            primary: calendar.primary ?? false,
          })),
        }),
      })
      return
    }

    const match = /^\/calendars\/([^/]+)\/events$/.exec(path)
    if (match?.[1]) {
      const calendarId = decodeURIComponent(match[1])
      const timeMin = url.searchParams.get('timeMin') ?? ''
      const timeMax = url.searchParams.get('timeMax') ?? ''
      state.eventRequests.push({ calendarId, timeMin, timeMax })
      if (state.forbidden.has(calendarId)) {
        await jsonError(route, 403, 'forbidden')
        return
      }
      const from = Date.parse(timeMin)
      const to = Date.parse(timeMax)
      const items = (state.events[calendarId] ?? [])
        .filter((event) => Date.parse(event.start) < to && Date.parse(event.end) > from)
        .map((event) => ({
          id: event.id,
          etag: `"${event.id}"`,
          summary: event.title,
          start: event.allDay ? { date: event.start } : { dateTime: event.start },
          end: event.allDay ? { date: event.end } : { dateTime: event.end },
        }))
      await route.fulfill({
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      })
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
