import { describe, expect, it, vi } from 'vitest'
import { weekRange } from '@/lib/dates'
import type { GoogleReader, QueryParams } from './client'
import { listCalendars, listEvents, listEventsForCalendars } from './calendar'
import { GoogleAccessError, GoogleApiError } from './errors'

const TZ = 'Europe/Stockholm'
// Måndag 19 okt 00:00 (UTC+2) till måndag 26 okt 00:00 (UTC+1, sommartiden slutar 25 okt).
const WEEK_RANGE = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const WEEK = { timeMin: WEEK_RANGE.start, timeMax: WEEK_RANGE.end, timeZone: TZ }
interface Call {
  path: string
  params: QueryParams
}

type Responder = (call: Call, index: number) => unknown

function fakeClient(responder: Responder) {
  const calls: Call[] = []
  // `async` gör att ett kastat fel blir ett avvisat löfte, som hos den riktiga klienten.
  const getJson = vi.fn((path: string, params: QueryParams = {}) => {
    const call = { path, params }
    calls.push(call)
    return Promise.resolve().then(() => responder(call, calls.length - 1))
  })
  const client: GoogleReader = { getJson: (path, params) => getJson(path, params) }
  return { client, calls }
}

function calendarEntry(id: string, extra: Record<string, unknown> = {}) {
  return { id, summary: id, backgroundColor: '#112233', accessRole: 'owner', ...extra }
}

function eventItem(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    etag: `"${id}"`,
    summary: `Event ${id}`,
    start: { dateTime: '2026-10-20T09:00:00+02:00' },
    end: { dateTime: '2026-10-20T10:00:00+02:00' },
    ...extra,
  }
}

describe('listCalendars', () => {
  it('hämtar alla sidor med hex-färger och tolkar kalendrarna', async () => {
    const { client, calls } = fakeClient((_call, index) =>
      index === 0
        ? {
            items: [
              calendarEntry('a', { primary: true, selected: true }),
              calendarEntry('gone', { deleted: true }),
            ],
            nextPageToken: 'page-2',
          }
        : { items: [calendarEntry('b')] },
    )

    const result = await listCalendars(client)

    expect(result.calendars.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.calendars[0]).toMatchObject({ primary: true, selected: true })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.path).toBe('/users/me/calendarList')
    expect(calls[0]?.params).toMatchObject({ colorRgbFormat: true, maxResults: 250 })
    expect(calls[0]?.params.pageToken).toBeUndefined()
    expect(calls[1]?.params.pageToken).toBe('page-2')
  })

  it('rapporterar trasiga poster utan att tappa resten', async () => {
    const { client } = fakeClient(() => ({
      items: [calendarEntry('ok'), { id: 'broken', backgroundColor: 'red' }],
    }))

    const result = await listCalendars(client)

    expect(result.calendars.map((c) => c.id)).toEqual(['ok'])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.id).toBe('broken')
  })

  it('rapporterar ett svar med fel form som badResponse', async () => {
    const { client } = fakeClient(() => ({ items: 'inte en lista' }))
    await expect(listCalendars(client)).rejects.toMatchObject({ kind: 'badResponse' })
  })

  it('ger upp om Google aldrig slutar skicka fler sidor', async () => {
    const { client, calls } = fakeClient(() => ({ items: [], nextPageToken: 'again' }))

    await expect(listCalendars(client)).rejects.toBeInstanceOf(GoogleApiError)
    expect(calls).toHaveLength(10)
  })
})

describe('listEvents', () => {
  it('ber om enskilda instanser för intervallet med tidszon och rätt offset', async () => {
    const { client, calls } = fakeClient(() => ({ items: [eventItem('e1')] }))

    const result = await listEvents(client, { calendarId: 'work', ...WEEK })

    expect(result.events.map((e) => e.id)).toEqual(['e1'])
    expect(result.events[0]).toMatchObject({ calendarId: 'work', title: 'Event e1', allDay: false })
    expect(result.truncated).toBe(false)
    expect(calls[0]?.path).toBe('/calendars/work/events')
    expect(calls[0]?.params).toMatchObject({
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: '2026-10-19T00:00:00+02:00',
      timeMax: '2026-10-26T00:00:00+01:00',
      timeZone: TZ,
      maxResults: 2500,
    })
  })

  it('kodar kalender-id med specialtecken i sökvägen', async () => {
    const { client, calls } = fakeClient(() => ({ items: [] }))

    await listEvents(client, {
      calendarId: 'sv.swedish#holiday@group.v.calendar.google.com',
      ...WEEK,
    })

    expect(calls[0]?.path).toBe(
      '/calendars/sv.swedish%23holiday%40group.v.calendar.google.com/events',
    )
  })

  it('hämtar alla sidor', async () => {
    const { client, calls } = fakeClient((_call, index) =>
      index === 0
        ? { items: [eventItem('e1')], nextPageToken: 'p2' }
        : { items: [eventItem('e2')] },
    )

    const result = await listEvents(client, { calendarId: 'c', ...WEEK })

    expect(result.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(calls[1]?.params.pageToken).toBe('p2')
  })

  it('tolkar heldagar, avbokade och trasiga händelser var för sig', async () => {
    const { client } = fakeClient(() => ({
      items: [
        eventItem('allday', { start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }),
        eventItem('cancelled', { status: 'cancelled' }),
        { id: 'broken' },
      ],
    }))

    const result = await listEvents(client, { calendarId: 'c', ...WEEK })

    expect(result.events.map((e) => [e.id, e.allDay])).toEqual([['allday', true]])
    expect(result.issues.map((i) => i.id)).toEqual(['broken'])
  })

  it('markerar resultatet som avkortat när det finns för många sidor', async () => {
    const { client, calls } = fakeClient(() => ({
      items: [eventItem('x')],
      nextPageToken: 'more',
    }))

    const result = await listEvents(client, { calendarId: 'c', ...WEEK })

    expect(result.truncated).toBe(true)
    expect(calls).toHaveLength(10)
  })

  it('skickar vidare avbrottssignalen', async () => {
    const getJson = vi.fn<GoogleReader['getJson']>(() => Promise.resolve({ items: [] }))
    const controller = new AbortController()

    await listEvents({ getJson }, { calendarId: 'c', ...WEEK }, { signal: controller.signal })

    expect(getJson.mock.calls[0]?.[2]).toEqual({ signal: controller.signal })
  })
})

describe('listEventsForCalendars', () => {
  const calendars = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  function eventsFor(path: string): string {
    return decodeURIComponent(path.split('/')[2] ?? '')
  }

  it('slår ihop händelser från alla kalendrar i kalenderordning', async () => {
    const { client } = fakeClient(({ path }) => ({
      items: [eventItem(`${eventsFor(path)}-1`)],
    }))

    const result = await listEventsForCalendars(client, { calendars, ...WEEK })

    expect(result.events.map((e) => [e.calendarId, e.id])).toEqual([
      ['a', 'a-1'],
      ['b', 'b-1'],
      ['c', 'c-1'],
    ])
    expect(result.failures).toEqual([])
  })

  it('låter en kalender som misslyckas stanna i failures utan att stoppa de andra', async () => {
    const { client } = fakeClient(({ path }) => {
      if (eventsFor(path) === 'b') throw new GoogleApiError('notFound', 404)
      return { items: [eventItem(`${eventsFor(path)}-1`)] }
    })

    const result = await listEventsForCalendars(client, { calendars, ...WEEK })

    expect(result.events.map((e) => e.calendarId)).toEqual(['a', 'c'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ calendarId: 'b' })
    expect(result.failures[0]?.error.kind).toBe('notFound')
  })

  it('kastar problem med åtkomsten direkt eftersom de drabbar alla kalendrar', async () => {
    const { client } = fakeClient(() => {
      throw new GoogleAccessError('access_revoked')
    })

    await expect(listEventsForCalendars(client, { calendars, ...WEEK })).rejects.toMatchObject({
      reason: 'access_revoked',
    })
  })

  it('kastar vidare oväntade fel', async () => {
    const { client } = fakeClient(() => {
      throw new Error('bugg')
    })

    await expect(listEventsForCalendars(client, { calendars, ...WEEK })).rejects.toThrow('bugg')
  })

  it('hämtar högst fyra kalendrar samtidigt som standard', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const client: GoogleReader = {
      getJson: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return { items: [] }
      },
    }
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `cal-${String(i)}` }))

    await listEventsForCalendars(client, { calendars: many, ...WEEK })

    expect(maxInFlight).toBe(4)
  })

  it('respekterar angiven samtidighet', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const client: GoogleReader = {
      getJson: async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return { items: [] }
      },
    }

    await listEventsForCalendars(client, { calendars, ...WEEK }, { concurrency: 1 })

    expect(maxInFlight).toBe(1)
  })

  it('använder kalenderns egen tidszon när den finns', async () => {
    const { client, calls } = fakeClient(() => ({ items: [] }))

    await listEventsForCalendars(client, {
      calendars: [{ id: 'ny', timeZone: 'America/New_York' }, { id: 'sthlm' }],
      ...WEEK,
    })

    const zones = Object.fromEntries(calls.map((c) => [eventsFor(c.path), c.params.timeZone]))
    expect(zones).toEqual({ ny: 'America/New_York', sthlm: TZ })
  })

  it('klarar noll kalendrar', async () => {
    const { client, calls } = fakeClient(() => ({ items: [] }))

    const result = await listEventsForCalendars(client, { calendars: [], ...WEEK })

    expect(result).toEqual({ events: [], issues: [], failures: [], truncatedCalendarIds: [] })
    expect(calls).toHaveLength(0)
  })

  it('anger vilka kalendrar som blev avkortade och märker problem med kalender', async () => {
    const { client } = fakeClient(({ path }) =>
      eventsFor(path) === 'a'
        ? { items: [{ id: 'broken' }], nextPageToken: 'more' }
        : { items: [] },
    )

    const result = await listEventsForCalendars(client, {
      calendars: [{ id: 'a' }, { id: 'b' }],
      ...WEEK,
    })

    expect(result.truncatedCalendarIds).toEqual(['a'])
    expect(result.issues).toHaveLength(10)
    expect(result.issues[0]).toMatchObject({ calendarId: 'a', id: 'broken' })
  })
})
