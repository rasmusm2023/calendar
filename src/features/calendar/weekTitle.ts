import { tz } from '@date-fns/tz'
import { getISOWeek, subDays } from 'date-fns'
import type { DateRange } from '@/lib/dates'

/** Veckans datumspann, t.ex. "19–25 okt. 2026" (sv) eller "Oct 19 – 25, 2026" (en). */
export function formatWeekSpan(range: DateRange, timeZone: string, locale: string): string {
  // `range.end` är exklusivt (nästa måndag). Visa söndagen.
  const lastDay = subDays(range.end, 1, { in: tz(timeZone) })
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).formatRange(range.start, lastDay)
}

/** ISO-veckonummer för veckan (måndag först, vecka 1 innehåller årets första torsdag). */
export function weekNumber(range: DateRange): number {
  return getISOWeek(range.start)
}
