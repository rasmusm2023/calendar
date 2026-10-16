import { describe, expect, it } from 'vitest'
import { FALLBACK_EVENT_COLOR } from '@/features/events'
import type { CalEvent } from '@/types'
import {
  DRAFT_CLASS,
  DRAFT_EVENT_ID,
  toFullCalendarDraft,
  toFullCalendarEvents,
  toFullCalendarId,
} from './mapEvents'

const TIMED: CalEvent = {
  id: 'e1',
  calendarId: 'work',
  etag: '"1"',
  title: 'Möte',
  start: '2026-10-19T09:00:00+02:00',
  end: '2026-10-19T10:00:00+02:00',
  allDay: false,
  important: false,
}

const ALL_DAY: CalEvent = {
  ...TIMED,
  id: 'e2',
  title: 'Semester',
  start: '2026-10-19',
  end: '2026-10-20',
  allDay: true,
}

const COLORS = new Map([['work', '#000000']])

describe('toFullCalendarEvents', () => {
  it('för över titel och tider oförändrade, även heldagar med exklusivt slut', () => {
    const [timed, allDay] = toFullCalendarEvents([TIMED, ALL_DAY], { calendarColors: COLORS })

    expect(timed).toMatchObject({
      title: 'Möte',
      start: '2026-10-19T09:00:00+02:00',
      end: '2026-10-19T10:00:00+02:00',
      allDay: false,
    })
    expect(allDay).toMatchObject({ start: '2026-10-19', end: '2026-10-20', allDay: true })
  })

  it('räknar ut färgerna med resolveEventStyle från kalenderns färg', () => {
    const [mapped] = toFullCalendarEvents([TIMED], { calendarColors: COLORS })

    expect(mapped).toMatchObject({
      backgroundColor: '#000000',
      borderColor: '#000000',
      textColor: '#ffffff',
    })
  })

  it('använder reservfärgen när kalendern inte är känd', () => {
    const [mapped] = toFullCalendarEvents([TIMED], { calendarColors: new Map() })

    expect(mapped).toMatchObject({ backgroundColor: FALLBACK_EVENT_COLOR })
  })

  it('gör händelserna skrivskyddade som standard och bär med kalender och händelse-id', () => {
    const [mapped] = toFullCalendarEvents([TIMED], { calendarColors: COLORS })

    expect(mapped).toMatchObject({
      editable: false,
      extendedProps: { calendarId: 'work', eventId: 'e1' },
    })
  })

  it('låter bara händelser i redigerbara kalendrar flyttas', () => {
    const readOnly: CalEvent = { ...TIMED, id: 'e3', calendarId: 'holidays' }

    const [writable, locked] = toFullCalendarEvents(
      [TIMED, readOnly],
      { calendarColors: COLORS },
      '',
      new Set(['work']),
    )

    expect(writable?.editable).toBe(true)
    expect(locked?.editable).toBe(false)
  })

  it('låter inte instanser av återkommande händelser flyttas ännu', () => {
    const [instance] = toFullCalendarEvents(
      [{ ...TIMED, recurringEventId: 'series' }],
      { calendarColors: COLORS },
      '',
      new Set(['work']),
    )

    expect(instance?.editable).toBe(false)
  })

  it('ger unika id:n även när två kalendrar har samma händelse-id', () => {
    const other: CalEvent = { ...TIMED, calendarId: 'private' }

    expect(toFullCalendarId(TIMED)).not.toBe(toFullCalendarId(other))
    const ids = toFullCalendarEvents([TIMED, other], { calendarColors: COLORS }).map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('ger en tom lista för inga händelser', () => {
    expect(toFullCalendarEvents([], { calendarColors: COLORS })).toEqual([])
  })
})

describe('titel utan text', () => {
  it('visar den angivna texten för en händelse utan titel, men rör inte riktiga titlar', () => {
    const [untitled, titled] = toFullCalendarEvents(
      [{ ...TIMED, title: '' }, TIMED],
      { calendarColors: COLORS },
      '(Ingen titel)',
    )

    expect(untitled?.title).toBe('(Ingen titel)')
    expect(titled?.title).toBe(TIMED.title)
  })
})

describe('toFullCalendarDraft', () => {
  const draft = {
    time: { start: '2026-10-19T09:00:00+02:00', end: '2026-10-19T10:00:00+02:00', allDay: false },
    calendarId: 'work',
    title: 'Ny händelse',
  }

  it('ritar utkastet i vald kalenders färg med egen klass och id', () => {
    const input = toFullCalendarDraft(draft, { calendarColors: COLORS })

    expect(input).toMatchObject({
      id: DRAFT_EVENT_ID,
      title: 'Ny händelse',
      start: draft.time.start,
      end: draft.time.end,
      allDay: false,
      backgroundColor: '#000000',
      classNames: [DRAFT_CLASS],
      editable: false,
      extendedProps: { isDraft: true },
    })
  })

  it('har ett id som inte kan förväxlas med en riktig händelse', () => {
    const real = toFullCalendarEvents([TIMED], { calendarColors: COLORS })[0]
    expect(real?.id).toBe('work/e1')
    expect(DRAFT_EVENT_ID).not.toContain('/')
  })

  it('klarar heldag och en kalender som saknar färg', () => {
    const input = toFullCalendarDraft(
      {
        ...draft,
        calendarId: 'okänd',
        time: { start: '2026-10-19', end: '2026-10-20', allDay: true },
      },
      { calendarColors: COLORS },
    )

    expect(input).toMatchObject({ allDay: true, start: '2026-10-19', end: '2026-10-20' })
    expect(input.backgroundColor).toBe(FALLBACK_EVENT_COLOR)
  })
})
