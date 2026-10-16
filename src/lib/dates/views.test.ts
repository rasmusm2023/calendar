import { describe, expect, it } from 'vitest'
import {
  addDaysInZone,
  addMonthsInZone,
  dayRange,
  monthGridRange,
  toRfc3339,
  type DateRange,
} from './index'

const TZ = 'Europe/Stockholm'

function iso(range: DateRange) {
  return [toRfc3339(range.start, TZ), toRfc3339(range.end, TZ)]
}

describe('dayRange', () => {
  it('är dygnet som ögonblicket tillhör, i given tidszon', () => {
    // 22:30 UTC den 20 okt är redan 00:30 den 21 okt i Stockholm.
    expect(iso(dayRange(new Date('2026-10-20T22:30:00Z'), TZ))).toEqual([
      '2026-10-21T00:00:00+02:00',
      '2026-10-22T00:00:00+02:00',
    ])
  })

  it('ger flera dygn med days', () => {
    expect(iso(dayRange(new Date('2026-10-21T12:00:00Z'), TZ, 3))).toEqual([
      '2026-10-21T00:00:00+02:00',
      '2026-10-24T00:00:00+02:00',
    ])
  })

  it('följer kalendern över sommartidsbyte (dygnet är 25 timmar)', () => {
    expect(iso(dayRange(new Date('2026-10-25T12:00:00Z'), TZ))).toEqual([
      '2026-10-25T00:00:00+02:00',
      '2026-10-26T00:00:00+01:00',
    ])
  })
})

describe('monthGridRange', () => {
  it('börjar på måndagen före månadens första dag och slutar måndagen efter den sista', () => {
    // Oktober 2026 börjar på en torsdag och slutar på en lördag.
    expect(iso(monthGridRange(new Date('2026-10-21T12:00:00Z'), TZ))).toEqual([
      '2026-09-28T00:00:00+02:00',
      '2026-11-02T00:00:00+01:00',
    ])
  })

  it('är exakt fyra veckor när månaden börjar på en måndag och har 28 dagar', () => {
    expect(iso(monthGridRange(new Date('2027-02-10T12:00:00Z'), TZ))).toEqual([
      '2027-02-01T00:00:00+01:00',
      '2027-03-01T00:00:00+01:00',
    ])
  })

  it('kan bli sex veckor', () => {
    // Augusti 2026 börjar på en lördag och slutar på en måndag.
    expect(iso(monthGridRange(new Date('2026-08-15T12:00:00Z'), TZ))).toEqual([
      '2026-07-27T00:00:00+02:00',
      '2026-09-07T00:00:00+02:00',
    ])
  })

  it('går att ställa in veckostart på söndag', () => {
    expect(iso(monthGridRange(new Date('2026-10-21T12:00:00Z'), TZ, 0))).toEqual([
      '2026-09-27T00:00:00+02:00',
      '2026-11-01T00:00:00+01:00',
    ])
  })

  it('tillhör månaden i given tidszon, inte i UTC', () => {
    // 23:30 UTC den 31 okt är redan 00:30 den 1 nov i Stockholm. November 2026 börjar på en söndag
    // och slutar på en måndag.
    expect(iso(monthGridRange(new Date('2026-10-31T23:30:00Z'), TZ))).toEqual([
      '2026-10-26T00:00:00+01:00',
      '2026-12-07T00:00:00+01:00',
    ])
  })
})

describe('addDaysInZone', () => {
  it('flyttar kalenderdygn, inte 24 timmar, över sommartidsbyte', () => {
    const moved = addDaysInZone(new Date('2026-10-24T22:00:00Z'), 1, TZ) // lör 25 okt 00:00 (+02:00)
    expect(toRfc3339(moved, TZ)).toBe('2026-10-26T00:00:00+01:00')
  })

  it('kan flytta bakåt', () => {
    expect(toRfc3339(addDaysInZone(new Date('2026-10-21T10:00:00Z'), -7, TZ), TZ)).toBe(
      '2026-10-14T12:00:00+02:00',
    )
  })
})

describe('addMonthsInZone', () => {
  it('flyttar kalendermånader och kapar dagen i en kortare månad', () => {
    expect(toRfc3339(addMonthsInZone(new Date('2026-01-31T10:00:00Z'), 1, TZ), TZ)).toBe(
      '2026-02-28T11:00:00+01:00',
    )
  })

  it('kan flytta bakåt över årsskifte', () => {
    expect(toRfc3339(addMonthsInZone(new Date('2026-01-15T10:00:00Z'), -1, TZ), TZ)).toBe(
      '2025-12-15T11:00:00+01:00',
    )
  })
})
