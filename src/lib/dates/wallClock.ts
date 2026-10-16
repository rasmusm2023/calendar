import { localDateTimeToRfc3339 } from './parse'
import { inZone } from './range'

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_ONLY = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Datumet ("2026-10-19") som ett ögonblick har i given tidszon. */
export function dateStringInZone(instant: Date | number, timeZone: string): string {
  const zoned = inZone(instant, timeZone)
  return `${pad(zoned.getFullYear(), 4)}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`
}

/** Klockslaget ("09:30", 24 timmar) som ett ögonblick har i given tidszon. */
export function timeStringInZone(instant: Date | number, timeZone: string): string {
  const zoned = inZone(instant, timeZone)
  return `${pad(zoned.getHours())}:${pad(zoned.getMinutes())}`
}

/** Sant om värdet är ett riktigt datum på formen "YYYY-MM-DD". */
export function isDateString(value: string): boolean {
  const match = DATE_ONLY.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  )
}

/** Sant om värdet är ett klockslag på formen "HH:mm" (00:00–23:59). */
export function isTimeString(value: string): boolean {
  return TIME_ONLY.test(value)
}

/**
 * Lägger `days` dagar till ett rent datum. Kalenderaritmetik, så sommartid spelar ingen roll.
 * Kastar för ogiltiga datum.
 */
export function addDaysToDateString(date: string, days: number): string {
  if (!isDateString(date)) throw new Error(`Ogiltigt datum: "${date}"`)
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS)
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** Antal dagar från `from` till `to` (negativt om `to` ligger före). */
export function daysBetweenDateStrings(from: string, to: string): number {
  if (!isDateString(from)) throw new Error(`Ogiltigt datum: "${from}"`)
  if (!isDateString(to)) throw new Error(`Ogiltigt datum: "${to}"`)
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((parse(to) - parse(from)) / DAY_MS)
}

/**
 * Datum och klockslag som användaren anger ("2026-10-19", "09:30") till RFC 3339 med offset i given
 * tidszon. Kastar om något av dem är ogiltigt.
 */
export function wallTimeToRfc3339(date: string, time: string, timeZone: string): string {
  if (!isDateString(date)) throw new Error(`Ogiltigt datum: "${date}"`)
  if (!isTimeString(time)) throw new Error(`Ogiltigt klockslag: "${time}"`)
  return localDateTimeToRfc3339(`${date}T${time}:00`, timeZone)
}
