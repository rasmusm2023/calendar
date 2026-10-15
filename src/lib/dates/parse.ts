import { TZDate } from '@date-fns/tz'
import { toRfc3339 } from './range'

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/

/**
 * Tolkar en ISO-sträng i given tidszon. Aldrig `new Date(string)` utan tidszon (PROJECT.md §7).
 *
 * - "2026-10-19"               -> midnatt i `timeZone` (heldag)
 * - "2026-10-19T09:00:00+02:00" / "...Z" -> exakt det ögonblicket, uttryckt i `timeZone`
 * - "2026-10-19T09:00:00"      -> kastar fel, eftersom tidszonen är tvetydig
 *
 * Google skickar `dateTime` med offset och `date` utan klockslag, så båda formerna täcks.
 */
export function parseIsoInZone(value: string, timeZone: string): TZDate {
  const dateOnly = DATE_ONLY.exec(value)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const result = new TZDate(Number(year), Number(month) - 1, Number(day), timeZone)
    if (
      result.getFullYear() !== Number(year) ||
      result.getMonth() !== Number(month) - 1 ||
      result.getDate() !== Number(day)
    ) {
      throw new Error(`Ogiltigt datum: "${value}"`)
    }
    return result
  }

  if (DATE_TIME.test(value)) {
    if (!HAS_OFFSET.test(value)) {
      throw new Error(`Tidsstämpel saknar tidszonsoffset: "${value}"`)
    }
    const instant = Date.parse(value)
    if (Number.isNaN(instant)) {
      throw new Error(`Ogiltig tidsstämpel: "${value}"`)
    }
    return new TZDate(instant, timeZone)
  }

  throw new Error(`Okänt datumformat: "${value}"`)
}

/**
 * Gör om en lokal tidsstämpel utan offset ("2026-10-19T09:00:00") till RFC 3339 med offset,
 * genom att tolka den som lokal tid i `timeZone`. För Googles `dateTime` som saknar offset men
 * har en explicit `timeZone`. Sekunder får utelämnas. Bråkdelssekunder avrundas bort.
 */
export function localDateTimeToRfc3339(value: string, timeZone: string): string {
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) {
    throw new Error(`Förväntade lokal tidsstämpel utan offset: "${value}"`)
  }
  const [, year, month, day, hour, minute, second] = match
  const date = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
    timeZone,
  )
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    throw new Error(`Ogiltigt datum: "${value}"`)
  }
  return toRfc3339(date, timeZone)
}
