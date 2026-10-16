import { addDaysToDateString, daysBetweenDateStrings, wallTimeToRfc3339 } from '@/lib/dates'
import type { EventTime } from '@/lib/google'
import type { EventEdit } from './eventEdit'

/**
 * Tidsberäkningar för ändringar av hela serier. Tiderna är som i `CalEvent`: ISO med offset för tidsbestämda,
 * rent datum för heldag. Allt räknas som kalenderdagar och klockslag, så sommartid ger rätt offset för varje dag.
 */

const dateOf = (value: string) => value.slice(0, 10)
const timeOf = (value: string) => value.slice(11, 16)

/** Antal dagar från datumet i `from` till datumet i `to`. */
export function dayDelta(from: string, to: string): number {
  return daysBetweenDateStrings(dateOf(from), dateOf(to))
}

/** Tidpunkten som ett ögonblick (RFC 3339), för anrop som kräver det. Rena datum börjar vid midnatt. */
export function toInstant(value: string, timeZone: string): string {
  return value.length === 10 ? wallTimeToRfc3339(value, '00:00', timeZone) : value
}

/** Starttiden i millisekunder, för att jämföra förekomster i tid. */
export function startMs(value: string): number {
  return Date.parse(value)
}

/**
 * Tiden `after` (klockslag och längd) flyttad så att den börjar `delta` dagar efter datumet i `baseStart`.
 * Så får varje förekomst i en serie samma nya klockslag och längd, men behåller sin egen dag (plus `delta`).
 */
export function timeOnDay(
  baseStart: string,
  delta: number,
  after: EventTime,
  timeZone: string,
): EventTime {
  const startDate = addDaysToDateString(dateOf(baseStart), delta)
  const span = daysBetweenDateStrings(dateOf(after.start), dateOf(after.end))
  const endDate = addDaysToDateString(startDate, span)
  if (after.allDay) return { start: startDate, end: endDate, allDay: true }
  return {
    start: wallTimeToRfc3339(startDate, timeOf(after.start), timeZone),
    end: wallTimeToRfc3339(endDate, timeOf(after.end), timeZone),
    allDay: false,
  }
}

/**
 * Ändringen `edit` så som den ska se ut för en förekomst (eller huvudhändelsen) som börjar vid `baseStart`.
 * Fälten är desamma. Tiden är `edit.time` flyttad till förekomstens egen dag, `delta` dagar bort.
 */
export function editForOccurrence(
  baseStart: string,
  edit: EventEdit,
  delta: number,
  timeZone: string,
): EventEdit {
  if (edit.time === undefined) return edit
  return { ...edit, time: timeOnDay(baseStart, delta, edit.time, timeZone) }
}
