import {
  addDaysToDateString,
  dateStringInZone,
  inZone,
  toRfc3339,
  wallTimeToRfc3339,
  type DateRange,
} from '@/lib/dates'
import type { EventTime } from '@/lib/google'

const HOUR_MS = 60 * 60 * 1000
const FALLBACK_START_TIME = '09:00'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Tiden för en ny händelse som skapas utan att peka i rutnätet (knappen "Ny händelse"): en timme från nästa
 * hela timme om perioden som visas innehåller "nu", annars 09:00-10:00 på den dag som visas.
 */
export function defaultNewEventTime(
  visible: DateRange,
  anchor: Date,
  now: Date,
  timeZone: string,
): EventTime {
  let date: string
  let time: string
  if (visible.start.getTime() <= now.getTime() && now.getTime() < visible.end.getTime()) {
    const hour = inZone(now, timeZone).getHours() + 1
    date = dateStringInZone(now, timeZone)
    if (hour === 24) date = addDaysToDateString(date, 1)
    time = `${pad(hour % 24)}:00`
  } else {
    date = dateStringInZone(anchor, timeZone)
    time = FALLBACK_START_TIME
  }
  const start = wallTimeToRfc3339(date, time, timeZone)
  const end = toRfc3339(new Date(Date.parse(start) + HOUR_MS), timeZone)
  return { start, end, allDay: false }
}
