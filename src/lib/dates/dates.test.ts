import { describe, expect, it } from 'vitest'
import { parseIsoInZone, shiftWeekRange, toRfc3339, weekRange } from './index'

const STOCKHOLM = 'Europe/Stockholm'
const HOUR = 3_600_000

/** Hjälp: visar intervallet som RFC 3339 i given tidszon. */
function describeRange(range: { start: Date; end: Date }, timeZone: string) {
  return [toRfc3339(range.start, timeZone), toRfc3339(range.end, timeZone)]
}

function hoursIn(range: { start: Date; end: Date }) {
  return (range.end.getTime() - range.start.getTime()) / HOUR
}

describe('weekRange', () => {
  it('börjar på måndag 00:00 och slutar nästa måndag 00:00 (standard)', () => {
    const range = weekRange(Date.parse('2026-10-15T12:00:00+02:00'), STOCKHOLM)
    expect(describeRange(range, STOCKHOLM)).toEqual([
      '2026-10-12T00:00:00+02:00',
      '2026-10-19T00:00:00+02:00',
    ])
  })

  it('räknar söndag som veckans sista dag och måndag 00:00 som ny vecka', () => {
    const sunday = weekRange(Date.parse('2026-10-18T23:59:00+02:00'), STOCKHOLM)
    const monday = weekRange(Date.parse('2026-10-19T00:00:00+02:00'), STOCKHOLM)
    expect(toRfc3339(sunday.start, STOCKHOLM)).toBe('2026-10-12T00:00:00+02:00')
    expect(toRfc3339(monday.start, STOCKHOLM)).toBe('2026-10-19T00:00:00+02:00')
  })

  it('utgår från den valda tidszonen, inte maskinens eller UTC', () => {
    // 22:30 UTC söndag är redan måndag 00:30 i Stockholm, men fortfarande söndag i UTC.
    const instant = Date.parse('2026-10-18T22:30:00Z')
    expect(toRfc3339(weekRange(instant, STOCKHOLM).start, STOCKHOLM)).toBe(
      '2026-10-19T00:00:00+02:00',
    )
    expect(toRfc3339(weekRange(instant, 'UTC').start, 'UTC')).toBe('2026-10-12T00:00:00Z')
  })

  it('hanterar hösttidens slut: veckan är 169 timmar', () => {
    const range = weekRange(Date.parse('2026-10-21T12:00:00+02:00'), STOCKHOLM)
    expect(describeRange(range, STOCKHOLM)).toEqual([
      '2026-10-19T00:00:00+02:00',
      '2026-10-26T00:00:00+01:00',
    ])
    expect(hoursIn(range)).toBe(169)
  })

  it('hanterar vårtidens start: veckan är 167 timmar', () => {
    const range = weekRange(Date.parse('2026-03-26T12:00:00+01:00'), STOCKHOLM)
    expect(describeRange(range, STOCKHOLM)).toEqual([
      '2026-03-23T00:00:00+01:00',
      '2026-03-30T00:00:00+02:00',
    ])
    expect(hoursIn(range)).toBe(167)
  })

  it('hanterar årsskifte', () => {
    const range = weekRange(Date.parse('2026-12-31T12:00:00+01:00'), STOCKHOLM)
    expect(describeRange(range, STOCKHOLM)).toEqual([
      '2026-12-28T00:00:00+01:00',
      '2027-01-04T00:00:00+01:00',
    ])
  })

  it('stödjer söndag som veckostart', () => {
    const range = weekRange(Date.parse('2026-10-15T12:00:00+02:00'), STOCKHOLM, 0)
    expect(toRfc3339(range.start, STOCKHOLM)).toBe('2026-10-11T00:00:00+02:00')
  })

  it('fungerar i tidszoner med halvtimmesoffset och på andra sidan datumgränsen', () => {
    const instant = Date.parse('2026-10-15T20:00:00Z')
    const kolkata = weekRange(instant, 'Asia/Kolkata') // redan fredag 01:30
    expect(toRfc3339(kolkata.start, 'Asia/Kolkata')).toBe('2026-10-12T00:00:00+05:30')
    const auckland = weekRange(instant, 'Pacific/Auckland')
    expect(toRfc3339(auckland.start, 'Pacific/Auckland')).toBe('2026-10-12T00:00:00+13:00')
  })
})

describe('shiftWeekRange', () => {
  const base = weekRange(Date.parse('2026-10-15T12:00:00+02:00'), STOCKHOLM)

  it('flyttar framåt och bakåt en vecka i taget', () => {
    expect(describeRange(shiftWeekRange(base, 1, STOCKHOLM), STOCKHOLM)).toEqual([
      '2026-10-19T00:00:00+02:00',
      '2026-10-26T00:00:00+01:00',
    ])
    expect(describeRange(shiftWeekRange(base, -1, STOCKHOLM), STOCKHOLM)).toEqual([
      '2026-10-05T00:00:00+02:00',
      '2026-10-12T00:00:00+02:00',
    ])
  })

  it('behåller lokal midnatt över sommartidsbyte', () => {
    const shifted = shiftWeekRange(base, 2, STOCKHOLM)
    expect(describeRange(shifted, STOCKHOLM)).toEqual([
      '2026-10-26T00:00:00+01:00',
      '2026-11-02T00:00:00+01:00',
    ])
  })

  it('är en no-op med 0 veckor', () => {
    expect(describeRange(shiftWeekRange(base, 0, STOCKHOLM), STOCKHOLM)).toEqual(
      describeRange(base, STOCKHOLM),
    )
  })
})

describe('toRfc3339', () => {
  const instant = new Date(Date.parse('2026-10-19T00:00:00+02:00'))

  it('formaterar med tidszonens offset', () => {
    expect(toRfc3339(instant, STOCKHOLM)).toBe('2026-10-19T00:00:00+02:00')
    expect(toRfc3339(instant, 'America/New_York')).toBe('2026-10-18T18:00:00-04:00')
    expect(toRfc3339(instant, 'UTC')).toBe('2026-10-18T22:00:00Z')
  })
})

describe('parseIsoInZone', () => {
  it('tolkar ett rent datum som midnatt i given tidszon (heldag)', () => {
    const parsed = parseIsoInZone('2026-10-19', STOCKHOLM)
    expect(toRfc3339(parsed, STOCKHOLM)).toBe('2026-10-19T00:00:00+02:00')
  })

  it('tolkar rent datum olika beroende på tidszon', () => {
    const stockholm = parseIsoInZone('2026-10-19', STOCKHOLM).getTime()
    const tokyo = parseIsoInZone('2026-10-19', 'Asia/Tokyo').getTime()
    expect(stockholm - tokyo).toBe(7 * HOUR)
  })

  it('tolkar tidsstämplar med offset och Z till samma ögonblick', () => {
    const withOffset = parseIsoInZone('2026-10-19T09:00:00+02:00', STOCKHOLM)
    const withZ = parseIsoInZone('2026-10-19T07:00:00Z', STOCKHOLM)
    expect(withOffset.getTime()).toBe(withZ.getTime())
    expect(toRfc3339(withOffset, STOCKHOLM)).toBe('2026-10-19T09:00:00+02:00')
  })

  it('uttrycker ögonblicket i begärd tidszon', () => {
    const parsed = parseIsoInZone('2026-10-19T09:00:00+02:00', 'America/New_York')
    expect(parsed.getHours()).toBe(3)
  })

  it('stödjer millisekunder', () => {
    const parsed = parseIsoInZone('2026-10-19T09:00:00.500+02:00', STOCKHOLM)
    expect(parsed.getMilliseconds()).toBe(500)
  })

  it('tolkar skottdagen men avvisar omöjliga datum', () => {
    expect(toRfc3339(parseIsoInZone('2028-02-29', 'UTC'), 'UTC')).toBe('2028-02-29T00:00:00Z')
    expect(() => parseIsoInZone('2026-02-30', 'UTC')).toThrow(/Ogiltigt datum/)
    expect(() => parseIsoInZone('2026-13-01', 'UTC')).toThrow(/Ogiltigt datum/)
  })

  it('kastar för tidsstämpel utan offset eftersom tidszonen vore en gissning', () => {
    expect(() => parseIsoInZone('2026-10-19T09:00:00', STOCKHOLM)).toThrow(/offset/)
  })

  it('kastar för okänt format', () => {
    expect(() => parseIsoInZone('i morgon', STOCKHOLM)).toThrow(/Okänt datumformat/)
    expect(() => parseIsoInZone('', STOCKHOLM)).toThrow(/Okänt datumformat/)
  })
})
