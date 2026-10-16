import { describe, expect, it, vi } from 'vitest'
import type { GoogleClient, WriteMethod, WriteRequest } from './client'
import { GoogleApiError } from './errors'
import {
  deleteEvent,
  generateEventId,
  getEvent,
  insertEvent,
  moveEvent,
  patchEvent,
  type NewEvent,
} from './eventWrites'

const TZ = 'Europe/Stockholm'
const REF = { calendarId: 'work@group.calendar.google.com', eventId: 'ev1' }

function googleEvent(extra: Record<string, unknown> = {}) {
  return {
    id: 'ev1',
    etag: '"etag-2"',
    summary: 'Gympass',
    start: { dateTime: '2026-10-20T09:00:00+02:00' },
    end: { dateTime: '2026-10-20T10:00:00+02:00' },
    ...extra,
  }
}

interface WriteCall {
  method: WriteMethod
  path: string
  request: WriteRequest | undefined
}

function fakeClient(
  options: {
    onWrite?: (call: WriteCall) => unknown
    onRead?: (path: string) => unknown
  } = {},
) {
  const writes: WriteCall[] = []
  const reads: string[] = []
  const client: GoogleClient = {
    getJson: vi.fn((path: string) => {
      reads.push(path)
      return Promise.resolve().then(() => options.onRead?.(path) ?? googleEvent())
    }),
    requestJson: vi.fn((method: WriteMethod, path: string, request?: WriteRequest) => {
      const call = { method, path, request }
      writes.push(call)
      return Promise.resolve().then(() => options.onWrite?.(call) ?? googleEvent())
    }),
  }
  return { client, writes, reads }
}

function body(call: WriteCall | undefined): Record<string, unknown> {
  return call?.request?.body as Record<string, unknown>
}

describe('generateEventId', () => {
  it('ger 26 tecken ur Googles tillåtna alfabet (a–v och 0–9)', () => {
    const id = generateEventId()
    expect(id).toMatch(/^[a-v0-9]{26}$/)
  })

  it('ger olika id varje gång', () => {
    expect(generateEventId()).not.toBe(generateEventId())
  })

  it('är bestämd av slumptalen', () => {
    const id = generateEventId((length) => Uint8Array.from({ length }, (_, i) => i))
    expect(id).toBe('abcdefghijklmnopqrstuv0123')
  })
})

describe('insertEvent', () => {
  const timed: NewEvent = {
    calendarId: 'primary',
    id: 'abc123',
    title: 'Gympass',
    start: '2026-10-20T09:00:00+02:00',
    end: '2026-10-20T10:00:00+02:00',
    allDay: false,
  }

  it('skickar id, titel och tider och ger tillbaka händelsen', async () => {
    const { client, writes } = fakeClient({ onWrite: () => googleEvent({ id: 'abc123' }) })

    const event = await insertEvent(client, timed, { timeZone: TZ })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.method).toBe('POST')
    expect(writes[0]?.path).toBe('/calendars/primary/events')
    expect(body(writes[0])).toEqual({
      id: 'abc123',
      summary: 'Gympass',
      start: { dateTime: '2026-10-20T09:00:00+02:00' },
      end: { dateTime: '2026-10-20T10:00:00+02:00' },
    })
    expect(event).toMatchObject({
      id: 'abc123',
      calendarId: 'primary',
      etag: '"etag-2"',
      title: 'Gympass',
      allDay: false,
    })
  })

  it('skickar heldag som date och utelämnar valfria fält som inte angetts', async () => {
    const { client, writes } = fakeClient({
      onWrite: () => googleEvent({ start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }),
    })

    const event = await insertEvent(
      client,
      { ...timed, allDay: true, start: '2026-10-20', end: '2026-10-21' },
      { timeZone: TZ },
    )

    expect(body(writes[0])).toEqual({
      id: 'abc123',
      summary: 'Gympass',
      start: { date: '2026-10-20' },
      end: { date: '2026-10-21' },
    })
    expect(event.allDay).toBe(true)
  })

  it('lagrar Viktig och familj i extendedProperties.private', async () => {
    const { client, writes } = fakeClient()

    await insertEvent(
      client,
      { ...timed, important: true, familyId: 'fam-1', location: 'Gymmet' },
      { timeZone: TZ },
    )

    expect(body(writes[0])).toMatchObject({
      location: 'Gymmet',
      extendedProperties: { private: { scImportant: '1', scFamilyId: 'fam-1' } },
    })
  })

  it('hämtar den redan skapade händelsen vid 409, så att ett nytt försök inte ger en dubblett', async () => {
    const { client, writes, reads } = fakeClient({
      onWrite: () => {
        throw new GoogleApiError('conflict', 409)
      },
      onRead: () => googleEvent({ id: 'abc123' }),
    })

    const event = await insertEvent(client, timed, { timeZone: TZ })

    expect(writes).toHaveLength(1)
    expect(reads).toEqual(['/calendars/primary/events/abc123'])
    expect(event.id).toBe('abc123')
  })

  it('kastar andra fel vidare', async () => {
    const { client } = fakeClient({
      onWrite: () => {
        throw new GoogleApiError('forbidden', 403)
      },
    })

    await expect(insertEvent(client, timed, { timeZone: TZ })).rejects.toMatchObject({
      kind: 'forbidden',
    })
  })

  it('räknar ett svar som inte går att tolka som badResponse', async () => {
    const { client } = fakeClient({ onWrite: () => ({ id: 'abc123' }) })

    await expect(insertEvent(client, timed, { timeZone: TZ })).rejects.toMatchObject({
      kind: 'badResponse',
    })
  })

  it('kodar kalender-id i sökvägen', async () => {
    const { client, writes } = fakeClient()

    await insertEvent(
      client,
      { ...timed, calendarId: 'a#b@group.calendar.google.com' },
      { timeZone: TZ },
    )

    expect(writes[0]?.path).toBe('/calendars/a%23b%40group.calendar.google.com/events')
  })
})

describe('patchEvent', () => {
  it('skickar bara de ändrade fälten och If-Match', async () => {
    const { client, writes } = fakeClient()

    await patchEvent(client, REF, { title: 'Nytt namn' }, { timeZone: TZ, etag: '"etag-1"' })

    expect(writes[0]?.method).toBe('PATCH')
    expect(writes[0]?.path).toBe('/calendars/work%40group.calendar.google.com/events/ev1')
    expect(body(writes[0])).toEqual({ summary: 'Nytt namn' })
    expect(writes[0]?.request?.ifMatch).toBe('"etag-1"')
  })

  it('utelämnar If-Match när etag saknas', async () => {
    const { client, writes } = fakeClient()

    await patchEvent(client, REF, { title: 'x' }, { timeZone: TZ })

    expect(writes[0]?.request).not.toHaveProperty('ifMatch')
  })

  it('tar bort det motsatta tidsfältet vid byte mellan tidsbestämd och heldag', async () => {
    const { client, writes } = fakeClient()

    await patchEvent(
      client,
      REF,
      { time: { start: '2026-10-20', end: '2026-10-21', allDay: true } },
      { timeZone: TZ },
    )
    await patchEvent(
      client,
      REF,
      {
        time: {
          start: '2026-10-20T09:00:00+02:00',
          end: '2026-10-20T10:00:00+02:00',
          allDay: false,
        },
      },
      { timeZone: TZ },
    )

    expect(body(writes[0])).toEqual({
      start: { date: '2026-10-20', dateTime: null },
      end: { date: '2026-10-21', dateTime: null },
    })
    expect(body(writes[1])).toEqual({
      start: { dateTime: '2026-10-20T09:00:00+02:00', date: null },
      end: { dateTime: '2026-10-20T10:00:00+02:00', date: null },
    })
  })

  it('sätter och rensar Viktig och familj, och rensar plats med null', async () => {
    const { client, writes } = fakeClient()

    await patchEvent(client, REF, { important: true, familyId: 'fam-1' }, { timeZone: TZ })
    await patchEvent(
      client,
      REF,
      { important: false, familyId: null, location: null },
      { timeZone: TZ },
    )

    expect(body(writes[0])).toEqual({
      extendedProperties: { private: { scImportant: '1', scFamilyId: 'fam-1' } },
    })
    expect(body(writes[1])).toEqual({
      location: null,
      extendedProperties: { private: { scImportant: null, scFamilyId: null } },
    })
  })

  it('ger tillbaka den uppdaterade händelsen med ny etag', async () => {
    const { client } = fakeClient({
      onWrite: () => googleEvent({ etag: '"etag-9"', summary: 'Nytt' }),
    })

    const event = await patchEvent(client, REF, { title: 'Nytt' }, { timeZone: TZ })

    expect(event).toMatchObject({ etag: '"etag-9"', title: 'Nytt', calendarId: REF.calendarId })
  })

  it('kastar preconditionFailed vidare när händelsen ändrats av någon annan', async () => {
    const { client } = fakeClient({
      onWrite: () => {
        throw new GoogleApiError('preconditionFailed', 412)
      },
    })

    await expect(
      patchEvent(client, REF, { title: 'x' }, { timeZone: TZ, etag: '"gammal"' }),
    ).rejects.toMatchObject({ kind: 'preconditionFailed' })
  })
})

describe('deleteEvent', () => {
  it('skickar DELETE och tillåter tomt svar', async () => {
    const { client, writes } = fakeClient({ onWrite: () => undefined })

    await deleteEvent(client, REF, { etag: '"etag-1"' })

    expect(writes[0]?.method).toBe('DELETE')
    expect(writes[0]?.request?.allowEmpty).toBe(true)
    expect(writes[0]?.request?.ifMatch).toBe('"etag-1"')
  })

  it.each(['notFound', 'gone'] as const)('räknar %s som lyckat (redan borta)', async (kind) => {
    const { client } = fakeClient({
      onWrite: () => {
        throw new GoogleApiError(kind)
      },
    })

    await expect(deleteEvent(client, REF)).resolves.toBeUndefined()
  })

  it('kastar andra fel, t.ex. preconditionFailed', async () => {
    const { client } = fakeClient({
      onWrite: () => {
        throw new GoogleApiError('preconditionFailed', 412)
      },
    })

    await expect(deleteEvent(client, REF, { etag: '"x"' })).rejects.toMatchObject({
      kind: 'preconditionFailed',
    })
  })
})

describe('moveEvent', () => {
  it('skickar destinationen och mappar händelsen till den nya kalendern', async () => {
    const { client, writes } = fakeClient()

    const event = await moveEvent(client, REF, 'other@group.calendar.google.com', { timeZone: TZ })

    expect(writes[0]?.method).toBe('POST')
    expect(writes[0]?.path).toBe('/calendars/work%40group.calendar.google.com/events/ev1/move')
    expect(writes[0]?.request?.params).toMatchObject({
      destination: 'other@group.calendar.google.com',
    })
    expect(event.calendarId).toBe('other@group.calendar.google.com')
  })
})

describe('getEvent', () => {
  it('hämtar en enskild händelse', async () => {
    const { client, reads } = fakeClient()

    const event = await getEvent(client, REF, { timeZone: TZ })

    expect(reads).toEqual(['/calendars/work%40group.calendar.google.com/events/ev1'])
    expect(event.title).toBe('Gympass')
  })
})
