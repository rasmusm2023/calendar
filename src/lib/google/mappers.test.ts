import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import { mapGoogleEvent, parseCalendarListPage, parseEventsPage } from './index'

const ctx = { calendarId: 'cal-1', fallbackTimeZone: 'Europe/Stockholm' }

// ---- calendarList ----------------------------------------------------------------------------

describe('parseCalendarListPage', () => {
  it('mappar en typisk kalender och normaliserar färgen till gemener', () => {
    const page = parseCalendarListPage({
      kind: 'calendar#calendarList',
      items: [
        {
          kind: 'calendar#calendarListEntry',
          id: 'me@example.com',
          summary: 'me@example.com',
          summaryOverride: 'Personligt',
          timeZone: 'Europe/Stockholm',
          backgroundColor: '#9FE1E7',
          foregroundColor: '#000000',
          selected: true,
          primary: true,
          accessRole: 'owner',
        },
      ],
    })
    expect(page.issues).toEqual([])
    expect(page.calendars).toEqual([
      {
        id: 'me@example.com',
        name: 'Personligt',
        backgroundColor: '#9fe1e7',
        selected: true,
        primary: true,
        accessRole: 'owner',
        timeZone: 'Europe/Stockholm',
      },
    ])
  })

  it('tolkar utelämnade booleans som false (så skickar Google dem)', () => {
    const [calendar] = parseCalendarListPage({
      items: [{ id: 'a', summary: 'Skola', backgroundColor: '#16a765', accessRole: 'reader' }],
    }).calendars
    expect(calendar?.selected).toBe(false)
    expect(calendar?.primary).toBe(false)
  })

  it('väljer namn i ordningen summaryOverride, summary, id', () => {
    const names = parseCalendarListPage({
      items: [
        {
          id: 'a',
          summary: 'S',
          summaryOverride: 'O',
          backgroundColor: '#000000',
          accessRole: 'owner',
        },
        { id: 'b', summary: 'S', backgroundColor: '#000000', accessRole: 'owner' },
        { id: 'c', backgroundColor: '#000000', accessRole: 'owner' },
      ],
    }).calendars.map((c) => c.name)
    expect(names).toEqual(['O', 'S', 'c'])
  })

  it('utelämnar raderade kalendrar', () => {
    const page = parseCalendarListPage({
      items: [
        { id: 'a', backgroundColor: '#000000', accessRole: 'owner', deleted: true },
        { id: 'b', backgroundColor: '#000000', accessRole: 'owner' },
      ],
    })
    expect(page.calendars.map((c) => c.id)).toEqual(['b'])
  })

  it('behandlar okänd åtkomstroll som skrivskyddad', () => {
    const [calendar] = parseCalendarListPage({
      items: [{ id: 'a', backgroundColor: '#000000', accessRole: 'superuser' }],
    }).calendars
    expect(calendar?.accessRole).toBe('reader')
  })

  it('rapporterar en trasig post men behåller resten av sidan', () => {
    const page = parseCalendarListPage({
      items: [
        { id: 'bad', summary: 'Utan färg', accessRole: 'owner' },
        { id: 'ok', backgroundColor: '#000000', accessRole: 'owner' },
        { summary: 'Utan id', backgroundColor: '#000000', accessRole: 'owner' },
      ],
    })
    expect(page.calendars.map((c) => c.id)).toEqual(['ok'])
    expect(page.issues).toHaveLength(2)
    expect(page.issues[0]).toMatchObject({ index: 0, id: 'bad' })
    expect(page.issues[1]).toMatchObject({ index: 2 })
  })

  it('avvisar färg som inte är hex (t.ex. om colorRgbFormat saknas)', () => {
    const page = parseCalendarListPage({
      items: [{ id: 'a', backgroundColor: 'blue', accessRole: 'owner' }],
    })
    expect(page.calendars).toEqual([])
    expect(page.issues).toHaveLength(1)
  })

  it('hanterar tom lista, och för vidare nextPageToken', () => {
    expect(parseCalendarListPage({}).calendars).toEqual([])
    expect(parseCalendarListPage({ items: [], nextPageToken: 'abc' }).nextPageToken).toBe('abc')
    expect(parseCalendarListPage({ items: [] })).not.toHaveProperty('nextPageToken')
  })

  it('kastar för ett svar med fel struktur', () => {
    expect(() => parseCalendarListPage({ items: 'inte en lista' })).toThrow(ZodError)
    expect(() => parseCalendarListPage(null)).toThrow(ZodError)
  })
})

// ---- events ----------------------------------------------------------------------------------

const timedEvent = {
  kind: 'calendar#event',
  id: 'evt1',
  etag: '"3181"',
  status: 'confirmed',
  summary: 'Planeringsmöte',
  location: 'Rum 4',
  start: { dateTime: '2026-10-19T09:00:00+02:00', timeZone: 'Europe/Stockholm' },
  end: { dateTime: '2026-10-19T10:00:00+02:00', timeZone: 'Europe/Stockholm' },
  colorId: '5',
  attendees: [{ email: 'x@example.com' }],
}

describe('parseEventsPage', () => {
  it('mappar en tidsbestämd händelse', () => {
    const page = parseEventsPage({ items: [timedEvent] }, ctx)
    expect(page.issues).toEqual([])
    expect(page.events).toEqual([
      {
        id: 'evt1',
        calendarId: 'cal-1',
        etag: '"3181"',
        title: 'Planeringsmöte',
        location: 'Rum 4',
        start: '2026-10-19T09:00:00+02:00',
        end: '2026-10-19T10:00:00+02:00',
        allDay: false,
        important: false,
      },
    ])
  })

  it('kopierar inte med färg eller andra fält som appen inte använder', () => {
    const [event] = parseEventsPage({ items: [timedEvent] }, ctx).events
    expect(event).not.toHaveProperty('colorId')
    expect(event).not.toHaveProperty('attendees')
    expect(event).not.toHaveProperty('bg')
  })

  it('mappar heldag med exklusivt slutdatum', () => {
    const [event] = parseEventsPage(
      {
        items: [
          {
            id: 'allday',
            etag: '"1"',
            summary: 'Semester',
            start: { date: '2026-10-19' },
            end: { date: '2026-10-21' },
          },
        ],
      },
      ctx,
    ).events
    expect(event).toMatchObject({ allDay: true, start: '2026-10-19', end: '2026-10-21' })
  })

  it('hoppar över avbokade händelser utan att rapportera dem som fel', () => {
    const page = parseEventsPage(
      { items: [{ id: 'gone', etag: '"1"', status: 'cancelled' }, timedEvent] },
      ctx,
    )
    expect(page.events.map((e) => e.id)).toEqual(['evt1'])
    expect(page.issues).toEqual([])
  })

  it('läser appens fält från extendedProperties.private', () => {
    const page = parseEventsPage(
      {
        items: [
          {
            ...timedEvent,
            id: 'a',
            extendedProperties: { private: { scFamilyId: 'fam-1', scImportant: '1' } },
          },
          {
            ...timedEvent,
            id: 'b',
            extendedProperties: { private: { scFamilyId: '', scImportant: '0' } },
          },
          { ...timedEvent, id: 'c', extendedProperties: { shared: { scImportant: '1' } } },
        ],
      },
      ctx,
    )
    const [a, b, c] = page.events
    expect(a).toMatchObject({ familyId: 'fam-1', important: true })
    expect(b?.important).toBe(false)
    expect(b).not.toHaveProperty('familyId')
    expect(c?.important).toBe(false) // shared-fält ignoreras
  })

  it('behåller recurringEventId på instanser av återkommande händelser', () => {
    const [event] = parseEventsPage(
      { items: [{ ...timedEvent, id: 'master_20261019T070000Z', recurringEventId: 'master' }] },
      ctx,
    ).events
    expect(event?.recurringEventId).toBe('master')
  })

  it('ger tom titel för händelse utan summary', () => {
    const [event] = parseEventsPage({ items: [{ ...timedEvent, summary: undefined }] }, ctx).events
    expect(event?.title).toBe('')
  })

  describe('lokal tid utan offset', () => {
    const local = (extra: Record<string, unknown> = {}, pageTz?: string) =>
      parseEventsPage(
        {
          ...(pageTz && { timeZone: pageTz }),
          items: [
            {
              ...timedEvent,
              start: { dateTime: '2026-10-19T09:00:00', ...extra },
              end: { dateTime: '2026-10-19T10:00:00', ...extra },
            },
          ],
        },
        ctx,
      ).events[0]

    it('använder händelsens egen tidszon i första hand', () => {
      expect(local({ timeZone: 'America/New_York' }, 'Asia/Tokyo')?.start).toBe(
        '2026-10-19T09:00:00-04:00',
      )
    })

    it('använder kalenderns tidszon därefter, och annars reservtidszonen', () => {
      expect(local({}, 'Asia/Tokyo')?.start).toBe('2026-10-19T09:00:00+09:00')
      expect(local({})?.start).toBe('2026-10-19T09:00:00+02:00')
    })
  })

  describe('trasiga poster', () => {
    it.each([
      ['saknar start och slut', { start: undefined, end: undefined }, /saknar start eller slut/],
      [
        'blandar heldag och tidsbestämd',
        { start: { date: '2026-10-19' }, end: { dateTime: '2026-10-19T10:00:00+02:00' } },
        /blandar heldag/,
      ],
      [
        'har både date och dateTime',
        {
          start: { date: '2026-10-19', dateTime: '2026-10-19T09:00:00+02:00' },
          end: { date: '2026-10-20' },
        },
        /både date och dateTime/,
      ],
      [
        'saknar både date och dateTime',
        { start: {}, end: { dateTime: '2026-10-19T10:00:00+02:00' } },
        /saknar både/,
      ],
      [
        'har ett omöjligt datum',
        { start: { date: '2026-02-30' }, end: { date: '2026-03-01' } },
        /Ogiltigt datum/,
      ],
      [
        'har ogiltig tidsstämpel',
        { start: { dateTime: 'igår' }, end: { dateTime: '2026-10-19T10:00:00+02:00' } },
        /lokal tidsstämpel/,
      ],
    ])('rapporterar händelse som %s och behåller övriga', (_name, patch, message) => {
      const page = parseEventsPage(
        {
          items: [
            { ...timedEvent, id: 'bad', ...patch },
            { ...timedEvent, id: 'good' },
          ],
        },
        ctx,
      )
      expect(page.events.map((e) => e.id)).toEqual(['good'])
      expect(page.issues).toHaveLength(1)
      expect(page.issues[0]).toMatchObject({ index: 0, id: 'bad' })
      expect(page.issues[0]?.message).toMatch(message)
    })

    it('rapporterar poster som saknar id eller etag', () => {
      const page = parseEventsPage(
        { items: [{ summary: 'x', start: {}, end: {} }, 42, null, timedEvent] },
        ctx,
      )
      expect(page.events).toHaveLength(1)
      expect(page.issues.map((i) => i.index)).toEqual([0, 1, 2])
    })
  })

  it('för vidare nextPageToken och kastar för svar med fel struktur', () => {
    expect(parseEventsPage({ items: [], nextPageToken: 'tok' }, ctx).nextPageToken).toBe('tok')
    expect(parseEventsPage({}, ctx).events).toEqual([])
    expect(() => parseEventsPage({ items: {} }, ctx)).toThrow(ZodError)
  })
})

describe('mapGoogleEvent', () => {
  it('returnerar null för avbokad händelse', () => {
    expect(mapGoogleEvent({ id: 'x', etag: '"1"', status: 'cancelled' }, ctx)).toBeNull()
  })
})

describe('beskrivning och påminnelser', () => {
  it('mappar beskrivning och egna påminnelser, och släpper metoder appen inte hanterar', () => {
    const [event] = parseEventsPage(
      {
        items: [
          {
            ...timedEvent,
            description: 'Ta med laptop',
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'popup', minutes: 10 },
                { method: 'sms', minutes: 30 },
                { method: 'email', minutes: 1440 },
              ],
            },
          },
        ],
      },
      ctx,
    ).events
    expect(event?.description).toBe('Ta med laptop')
    expect(event?.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 },
        { method: 'email', minutes: 1440 },
      ],
    })
  })

  it('mappar useDefault: true utan att läsa med några egna påminnelser', () => {
    const [event] = parseEventsPage(
      {
        items: [
          {
            ...timedEvent,
            reminders: { useDefault: true, overrides: [{ method: 'popup', minutes: 5 }] },
          },
        ],
      },
      ctx,
    ).events
    expect(event?.reminders).toEqual({ useDefault: true })
  })

  it('tolkar reminders utan useDefault och utan lista som inga påminnelser', () => {
    const [event] = parseEventsPage({ items: [{ ...timedEvent, reminders: {} }] }, ctx).events
    expect(event?.reminders).toEqual({ useDefault: false, overrides: [] })
  })

  it('lämnar fälten tomma när Google inte skickar dem, och en tom beskrivning räknas som ingen', () => {
    const [event] = parseEventsPage({ items: [{ ...timedEvent, description: '' }] }, ctx).events
    expect(event).not.toHaveProperty('reminders')
    expect(event).not.toHaveProperty('description')
  })

  it('läser kalenderns standardpåminnelser', () => {
    const [calendar] = parseCalendarListPage({
      items: [
        {
          id: 'a',
          summary: 'Jobb',
          backgroundColor: '#16a765',
          accessRole: 'owner',
          defaultReminders: [
            { method: 'popup', minutes: 10 },
            { method: 'sms', minutes: 5 },
          ],
        },
      ],
    }).calendars
    expect(calendar?.defaultReminders).toEqual([{ method: 'popup', minutes: 10 }])
  })

  it('utelämnar defaultReminders när Google inte skickar dem', () => {
    const [calendar] = parseCalendarListPage({
      items: [{ id: 'a', summary: 'Jobb', backgroundColor: '#16a765', accessRole: 'owner' }],
    }).calendars
    expect(calendar).not.toHaveProperty('defaultReminders')
  })
})
