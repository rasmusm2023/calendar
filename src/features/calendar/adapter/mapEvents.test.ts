import { describe, expect, it } from 'vitest'
import { FALLBACK_EVENT_COLOR } from '@/features/events'
import type { CalEvent } from '@/types'
import { toFullCalendarEvents, toFullCalendarId } from './mapEvents'

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

  it('gör händelserna skrivskyddade och bär med kalender och händelse-id', () => {
    const [mapped] = toFullCalendarEvents([TIMED], { calendarColors: COLORS })

    expect(mapped).toMatchObject({
      editable: false,
      extendedProps: { calendarId: 'work', eventId: 'e1' },
    })
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
