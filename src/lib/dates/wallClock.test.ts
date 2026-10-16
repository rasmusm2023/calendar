import { describe, expect, it } from 'vitest'
import {
  addDaysToDateString,
  dateStringInZone,
  daysBetweenDateStrings,
  isDateString,
  isTimeString,
  timeStringInZone,
  wallTimeToRfc3339,
} from './wallClock'

const TZ = 'Europe/Stockholm'

describe('dateStringInZone och timeStringInZone', () => {
  it('ger datum och klockslag i tidszonen, inte i UTC', () => {
    const instant = new Date('2026-10-19T22:30:00Z')
    expect(dateStringInZone(instant, TZ)).toBe('2026-10-20')
    expect(timeStringInZone(instant, TZ)).toBe('00:30')
    expect(dateStringInZone(instant, 'America/New_York')).toBe('2026-10-19')
    expect(timeStringInZone(instant, 'America/New_York')).toBe('18:30')
  })

  it('använder 24 timmar och nollfyllning', () => {
    expect(timeStringInZone(new Date('2026-10-19T07:05:00Z'), 'UTC')).toBe('07:05')
    expect(timeStringInZone(new Date('2026-10-19T23:59:00Z'), 'UTC')).toBe('23:59')
  })
})

describe('isDateString och isTimeString', () => {
  it('godtar riktiga datum och tider', () => {
    expect(isDateString('2026-10-19')).toBe(true)
    expect(isDateString('2028-02-29')).toBe(true)
    expect(isTimeString('00:00')).toBe(true)
    expect(isTimeString('23:59')).toBe(true)
  })

  it('nekar ogiltiga värden', () => {
    expect(isDateString('2026-02-30')).toBe(false)
    expect(isDateString('2026-13-01')).toBe(false)
    expect(isDateString('2026-1-1')).toBe(false)
    expect(isDateString('')).toBe(false)
    expect(isTimeString('24:00')).toBe(false)
    expect(isTimeString('9:30')).toBe(false)
    expect(isTimeString('09:60')).toBe(false)
    expect(isTimeString('')).toBe(false)
  })
})

describe('addDaysToDateString och daysBetweenDateStrings', () => {
  it('lägger till och drar bort dagar över månads- och årsskiften', () => {
    expect(addDaysToDateString('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDateString('2026-10-19', 0)).toBe('2026-10-19')
  })

  it('påverkas inte av sommartidsbyte', () => {
    expect(addDaysToDateString('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDaysToDateString('2026-03-28', 2)).toBe('2026-03-30')
  })

  it('räknar dagar mellan två datum', () => {
    expect(daysBetweenDateStrings('2026-10-19', '2026-10-22')).toBe(3)
    expect(daysBetweenDateStrings('2026-10-22', '2026-10-19')).toBe(-3)
    expect(daysBetweenDateStrings('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetweenDateStrings('2026-10-19', '2026-10-19')).toBe(0)
  })

  it('kastar för ogiltiga datum', () => {
    expect(() => addDaysToDateString('2026-02-30', 1)).toThrow()
    expect(() => daysBetweenDateStrings('x', '2026-10-19')).toThrow()
    expect(() => daysBetweenDateStrings('2026-10-19', 'x')).toThrow()
  })
})

describe('wallTimeToRfc3339', () => {
  it('ger offset för tidszonen och datumet', () => {
    expect(wallTimeToRfc3339('2026-10-19', '09:30', TZ)).toBe('2026-10-19T09:30:00+02:00')
    expect(wallTimeToRfc3339('2026-11-02', '09:30', TZ)).toBe('2026-11-02T09:30:00+01:00')
  })

  it('kastar för ogiltigt datum eller klockslag', () => {
    expect(() => wallTimeToRfc3339('2026-02-30', '09:30', TZ)).toThrow()
    expect(() => wallTimeToRfc3339('2026-10-19', '25:00', TZ)).toThrow()
  })
})
