import { addDaysToDateString } from '@/lib/dates'

/**
 * Hjälpare för Googles återkomstregler (RFC 5545, `recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", ...]`).
 * Vi expanderar aldrig regler själva (Google ger instanser, PROJECT.md §5.4). Det vi gör är att korta av en
 * serie ("denna och följande"), flytta en regel några dagar ("alla" efter att en instans dragits till en annan dag)
 * och räkna ut vad som återstår av en serie med COUNT.
 */

const RRULE_PREFIX = 'RRULE:'
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
const PLAIN_WEEKDAY = /^(MO|TU|WE|TH|FR|SA|SU)$/
/** Delar av en regel som styr vilka dagar den träffar, och som därför inte följer med när startdatumet flyttas. */
const DAY_SELECTING_PARTS = [
  'BYDAY',
  'BYMONTHDAY',
  'BYYEARDAY',
  'BYWEEKNO',
  'BYMONTH',
  'BYSETPOS',
] as const

export type RuleParts = Map<string, string>

/** `RRULE:A=1;B=2` som delar, i ordning. Andra rader (EXDATE, RDATE) ger `null`. */
export function parseRule(line: string): RuleParts | null {
  if (!line.toUpperCase().startsWith(RRULE_PREFIX)) return null
  const parts: RuleParts = new Map()
  for (const part of line.slice(RRULE_PREFIX.length).split(';')) {
    const at = part.indexOf('=')
    if (at > 0) parts.set(part.slice(0, at).toUpperCase(), part.slice(at + 1))
  }
  return parts
}

function formatRule(parts: RuleParts): string {
  return `${RRULE_PREFIX}${[...parts].map(([key, value]) => `${key}=${value}`).join(';')}`
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Ett ögonblick som UTC-tid på formen `20261020T215959Z`. */
function utcStamp(instant: Date): string {
  return (
    `${pad(instant.getUTCFullYear(), 4)}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`
  )
}

/**
 * Sista tillåtna tid (UNTIL) för en serie som ska sluta strax före en instans. `originalStart` är instansens
 * ursprungliga start: "2026-10-21" för heldag, annars RFC 3339. Heldag ger ett datum ("20261020"), annars UTC
 * en sekund före ("20261021T065959Z"), som reglerna kräver.
 */
export function untilBefore(originalStart: string, allDay: boolean): string {
  if (allDay) return addDaysToDateString(originalStart.slice(0, 10), -1).replaceAll('-', '')
  const instant = new Date(Date.parse(originalStart) - 1000)
  if (Number.isNaN(instant.getTime())) throw new Error(`Ogiltig starttid: "${originalStart}"`)
  return utcStamp(instant)
}

/** Raderna som är regler (RRULE), utan t.ex. EXDATE och RDATE. */
export function ruleLines(recurrence: readonly string[]): string[] {
  return recurrence.filter((line) => parseRule(line) !== null)
}

/** Antal förekomster som regeln begränsas till (COUNT), eller `undefined` om den inte har någon. */
export function ruleCount(recurrence: readonly string[]): number | undefined {
  for (const line of recurrence) {
    const count = parseRule(line)?.get('COUNT')
    if (count !== undefined) {
      const value = Number(count)
      return Number.isInteger(value) && value > 0 ? value : undefined
    }
  }
  return undefined
}

/**
 * Kortar av serien så att den slutar före en instans: UNTIL sätts och COUNT tas bort (de får inte finnas
 * samtidigt). Övriga rader, som EXDATE, behålls.
 */
export function truncateRecurrence(
  recurrence: readonly string[],
  originalStart: string,
  allDay: boolean,
): string[] {
  const until = untilBefore(originalStart, allDay)
  return recurrence.map((line) => {
    const parts = parseRule(line)
    if (parts === null) return line
    parts.delete('COUNT')
    parts.set('UNTIL', until)
    return formatRule(parts)
  })
}

/**
 * Reglerna för en ny serie som tar över efter en avkortad: bara regelrader (EXDATE/RDATE hör till den gamla serien),
 * med COUNT satt till det som återstår (`remaining`), om regeln hade COUNT.
 */
export function continuationRules(
  recurrence: readonly string[],
  remaining: number | undefined,
): string[] {
  return ruleLines(recurrence).map((line) => {
    const parts = parseRule(line)
    if (parts === null) return line
    if (parts.has('COUNT') && remaining !== undefined) parts.set('COUNT', String(remaining))
    return formatRule(parts)
  })
}

/**
 * Anpassar UNTIL när serien byter mellan heldag och tidsbestämd (datum respektive UTC-tid), så att det passar
 * starttiden. Regler utan UNTIL rörs inte.
 */
export function matchUntilToKind(recurrence: readonly string[], allDay: boolean): string[] {
  return recurrence.map((line) => {
    const parts = parseRule(line)
    const until = parts?.get('UNTIL')
    if (parts === null || until === undefined) return line
    const isDate = !until.includes('T')
    if (isDate === allDay) return line
    parts.set('UNTIL', allDay ? until.slice(0, 8) : `${until.slice(0, 8)}T235959Z`)
    return formatRule(parts)
  })
}

/**
 * Flyttar en regel `dayDelta` dagar, för när en serie flyttas så att varje förekomst hamnar lika många dagar
 * senare. Det som följer startdatumet (dagligen, veckovis utan veckodagar, månadsvis och årligen utan
 * BY-delar) behöver inget göras. Veckovis med veckodagar får veckodagarna flyttade. Regler som väljer dagar på
 * andra sätt (t.ex. andra tisdagen i månaden) går inte att flytta på ett säkert sätt och ger `null`.
 */
export function shiftRecurrenceDays(
  recurrence: readonly string[],
  dayDelta: number,
): string[] | null {
  if (dayDelta === 0) return [...recurrence]
  const shifted: string[] = []
  for (const line of recurrence) {
    const parts = parseRule(line)
    if (parts === null) {
      shifted.push(line)
      continue
    }
    const selecting = DAY_SELECTING_PARTS.filter((part) => parts.has(part))
    if (selecting.length === 0) {
      shifted.push(line)
      continue
    }
    const byDay = parts.get('BYDAY')
    const weekly = parts.get('FREQ') === 'WEEKLY'
    if (!weekly || selecting.length !== 1 || byDay === undefined) return null
    const days = byDay.split(',').map((day) => day.toUpperCase())
    if (!days.every((day) => PLAIN_WEEKDAY.test(day))) return null
    parts.set(
      'BYDAY',
      days
        .map((day) => {
          const at = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number])
          return WEEKDAYS[(((at + dayDelta) % 7) + 7) % 7]
        })
        .join(','),
    )
    shifted.push(formatRule(parts))
  }
  return shifted
}
