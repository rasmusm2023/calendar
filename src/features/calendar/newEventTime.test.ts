import { describe, expect, it } from 'vitest'
import { weekRange } from '@/lib/dates'
import { defaultNewEventTime } from './newEventTime'

const TZ = 'Europe/Stockholm'
// Vecka 43: 19-25 okt 2026.
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)

describe('defaultNewEventTime', () => {
  it('börjar vid nästa hela timme när perioden innehåller nu', () => {
    const now = new Date('2026-10-21T10:20:00Z') // 12:20 i Stockholm
    expect(defaultNewEventTime(WEEK, now, now, TZ)).toEqual({
      start: '2026-10-21T13:00:00+02:00',
      end: '2026-10-21T14:00:00+02:00',
      allDay: false,
    })
  })

  it('går vidare till nästa hela timme även när klockan är exakt hel', () => {
    const now = new Date('2026-10-21T10:00:00Z')
    expect(defaultNewEventTime(WEEK, now, now, TZ).start).toBe('2026-10-21T13:00:00+02:00')
  })

  it('går över midnatt sent på kvällen', () => {
    const now = new Date('2026-10-21T21:30:00Z') // 23:30
    expect(defaultNewEventTime(WEEK, now, now, TZ)).toEqual({
      start: '2026-10-22T00:00:00+02:00',
      end: '2026-10-22T01:00:00+02:00',
      allDay: false,
    })
  })

  it('räknar i tidszonen och inte i UTC', () => {
    const now = new Date('2026-10-21T22:30:00Z') // 00:30 torsdag i Stockholm
    expect(defaultNewEventTime(WEEK, now, now, TZ).start).toBe('2026-10-22T01:00:00+02:00')
  })

  it('tar 09:00-10:00 på visad dag när nu inte syns', () => {
    const now = new Date('2026-10-10T10:20:00Z')
    const anchor = new Date('2026-10-21T12:00:00Z')
    expect(defaultNewEventTime(WEEK, anchor, now, TZ)).toEqual({
      start: '2026-10-21T09:00:00+02:00',
      end: '2026-10-21T10:00:00+02:00',
      allDay: false,
    })
  })

  it('använder rätt offset efter sommartidens slut', () => {
    const week = weekRange(new Date('2026-11-04T12:00:00Z'), TZ)
    const now = new Date('2026-01-01T00:00:00Z')
    expect(defaultNewEventTime(week, new Date('2026-11-04T12:00:00Z'), now, TZ).start).toBe(
      '2026-11-04T09:00:00+01:00',
    )
  })
})
