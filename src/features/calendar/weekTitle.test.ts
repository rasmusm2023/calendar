import { describe, expect, it } from 'vitest'
import { weekRange } from '@/lib/dates'
import { formatWeekSpan, weekNumber } from './weekTitle'

const TZ = 'Europe/Stockholm'

/** Intl använder smala mellanrum runt tankstreck. Gör dem till vanliga mellanslag. */
const normalize = (text: string) => text.replace(/\s/g, ' ')

describe('formatWeekSpan', () => {
  it('visar måndag till söndag, inte nästa måndag', () => {
    const range = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)

    const sv = formatWeekSpan(range, TZ, 'sv')
    // Söndag 25:e är sista dagen. Nästa måndag (26:e) ska inte vara med.
    expect(sv).toMatch(/^19.25 okt/)
  })

  it('hanterar vecka över månadsskifte och sommartidsbyte', () => {
    // 26 okt - 1 nov, och veckan före (sommartiden slutar 25 okt).
    const monthChange = weekRange(new Date('2026-10-28T12:00:00Z'), TZ)
    expect(normalize(formatWeekSpan(monthChange, TZ, 'en'))).toBe('Oct 26 – Nov 1, 2026')

    const dstWeek = weekRange(new Date('2026-10-22T12:00:00Z'), TZ)
    expect(normalize(formatWeekSpan(dstWeek, TZ, 'en'))).toBe('Oct 19 – 25, 2026')
  })
})

describe('weekNumber', () => {
  it('ger ISO-veckonummer', () => {
    expect(weekNumber(weekRange(new Date('2026-10-21T12:00:00Z'), TZ))).toBe(43)
    // Vecka 1 2027 börjar måndag 4 jan.
    expect(weekNumber(weekRange(new Date('2027-01-05T12:00:00Z'), TZ))).toBe(1)
    // 1 jan 2027 (fredag) hör till vecka 53 2026.
    expect(weekNumber(weekRange(new Date('2027-01-01T12:00:00Z'), TZ))).toBe(53)
  })
})
