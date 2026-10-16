import { TZDate, tz } from '@date-fns/tz'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  formatISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type Day,
} from 'date-fns'

/** Veckan börjar på måndag som standard (PRD 6.2). */
export const DEFAULT_WEEK_STARTS_ON: Day = 1

/** Halvöppet intervall [start, end). Båda är tidszonsmedvetna. */
export interface DateRange {
  start: TZDate
  end: TZDate
}

/** Webbläsarens tidszon (IANA-namn), t.ex. "Europe/Stockholm". */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Ett ögonblick uttryckt i given tidszon. */
export function inZone(instant: Date | number, timeZone: string): TZDate {
  const millis = typeof instant === 'number' ? instant : instant.getTime()
  return new TZDate(millis, timeZone)
}

/** Första ögonblicket (00:00 lokal tid) på veckan som `instant` tillhör, i given tidszon. */
export function startOfWeekInZone(
  instant: Date | number,
  timeZone: string,
  weekStartsOn: Day = DEFAULT_WEEK_STARTS_ON,
): TZDate {
  return startOfWeek(inZone(instant, timeZone), { weekStartsOn, in: tz(timeZone) })
}

/**
 * Veckan som `instant` tillhör, som [måndag 00:00, nästa måndag 00:00) i given tidszon.
 * Längden följer kalendern, så en vecka med sommartidsbyte blir 167 eller 169 timmar.
 */
export function weekRange(
  instant: Date | number,
  timeZone: string,
  weekStartsOn: Day = DEFAULT_WEEK_STARTS_ON,
): DateRange {
  const start = startOfWeekInZone(instant, timeZone, weekStartsOn)
  return { start, end: addWeeks(start, 1, { in: tz(timeZone) }) }
}

/** Flyttar ett intervall (som börjar på veckostart) `weeks` veckor, positivt framåt. */
export function shiftWeekRange(range: DateRange, weeks: number, timeZone: string): DateRange {
  const start = addWeeks(range.start, weeks, { in: tz(timeZone) })
  return { start, end: addWeeks(start, 1, { in: tz(timeZone) }) }
}

/** RFC 3339 med tidszonsoffset, t.ex. "2026-10-19T00:00:00+02:00". Används mot Google (timeMin/timeMax). */
export function toRfc3339(instant: Date, timeZone: string): string {
  return formatISO(inZone(instant, timeZone))
}

/** days hela dygn från och med dygnet som instant tillhör, som [00:00, 00:00 days dygn senare). */
export function dayRange(instant: Date | number, timeZone: string, days = 1): DateRange {
  const start = startOfDay(inZone(instant, timeZone), { in: tz(timeZone) })
  return { start, end: addDays(start, days, { in: tz(timeZone) }) }
}

/**
 * Månadsrutnätet för månaden som instant tillhör: hela veckor från veckan där månaden börjar till och
 * med veckan där den slutar. Det är exakt det som en månadsvy visar (utan fast antal veckor).
 */
export function monthGridRange(
  instant: Date | number,
  timeZone: string,
  weekStartsOn: Day = DEFAULT_WEEK_STARTS_ON,
): DateRange {
  const zoned = inZone(instant, timeZone)
  const options = { in: tz(timeZone) }
  const start = startOfWeek(startOfMonth(zoned, options), { weekStartsOn, ...options })
  const lastWeekStart = startOfWeek(endOfMonth(zoned, options), { weekStartsOn, ...options })
  return { start, end: addWeeks(lastWeekStart, 1, options) }
}

/** Flyttar ett ögonblick days kalenderdygn (en dag med sommartidsbyte är 23 eller 25 timmar). */
export function addDaysInZone(instant: Date | number, days: number, timeZone: string): TZDate {
  return addDays(inZone(instant, timeZone), days, { in: tz(timeZone) })
}

/** Flyttar ett ögonblick months kalendermånader. Dagen kapas om månaden är kortare (31 jan blir 28 feb). */
export function addMonthsInZone(instant: Date | number, months: number, timeZone: string): TZDate {
  return addMonths(inZone(instant, timeZone), months, { in: tz(timeZone) })
}
