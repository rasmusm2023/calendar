import {
  addDaysToDateString,
  dateStringInZone,
  daysBetweenDateStrings,
  isDateString,
  isTimeString,
  parseIsoInZone,
  timeStringInZone,
  wallTimeToRfc3339,
} from '@/lib/dates'
import type { EventTime } from '@/lib/google'

/**
 * Tiderna i snabbpopoverns formulär, som text från datum- och tidsfält. För heldag är `endDate`
 * sista dagen (inklusive), som man ser det i ett formulär. Hos Google är slutet exklusivt, så
 * `eventTimeFromForm` lägger till en dag.
 *
 * Klockslagen finns kvar när heldag är på, så att de är tillbaka när man slår av det igen.
 */
export interface FormTimes {
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '10:00'

export function formFromEventTime(time: EventTime, timeZone: string): FormTimes {
  if (time.allDay) {
    const lastDay = addDaysToDateString(time.end, -1)
    return {
      allDay: true,
      startDate: time.start,
      startTime: DEFAULT_START_TIME,
      endDate: daysBetweenDateStrings(time.start, lastDay) < 0 ? time.start : lastDay,
      endTime: DEFAULT_END_TIME,
    }
  }
  const start = parseIsoInZone(time.start, timeZone)
  const end = parseIsoInZone(time.end, timeZone)
  return {
    allDay: false,
    startDate: dateStringInZone(start, timeZone),
    startTime: timeStringInZone(start, timeZone),
    endDate: dateStringInZone(end, timeZone),
    endTime: timeStringInZone(end, timeZone),
  }
}

/** Tiden som formuläret beskriver, eller `null` om något saknas eller slutet inte ligger efter början. */
export function eventTimeFromForm(form: FormTimes, timeZone: string): EventTime | null {
  if (!isDateString(form.startDate) || !isDateString(form.endDate)) return null

  if (form.allDay) {
    if (daysBetweenDateStrings(form.startDate, form.endDate) < 0) return null
    return { start: form.startDate, end: addDaysToDateString(form.endDate, 1), allDay: true }
  }

  if (!isTimeString(form.startTime) || !isTimeString(form.endTime)) return null
  const start = wallTimeToRfc3339(form.startDate, form.startTime, timeZone)
  const end = wallTimeToRfc3339(form.endDate, form.endTime, timeZone)
  if (Date.parse(end) <= Date.parse(start)) return null
  return { start, end, allDay: false }
}

/**
 * Ändrar start och flyttar slutet lika mycket, så att längden behålls (som i Google Calendar).
 *
 * Under redigering är formuläret ibland ofullständigt (ett fält är tomt medan man skriver). Då räknas
 * längden ur `lastValid`, den senaste giltiga tiden, så att den inte går förlorad. Saknas den, eller blir
 * starten ogiltig, ändras bara det som angavs.
 */
export function changeStart(
  form: FormTimes,
  patch: Partial<Pick<FormTimes, 'startDate' | 'startTime'>>,
  timeZone: string,
  lastValid: EventTime | null = null,
): FormTimes {
  const next = { ...form, ...patch }
  const reference =
    eventTimeFromForm(form, timeZone) ?? (lastValid?.allDay === form.allDay ? lastValid : null)
  if (reference === null || !isDateString(next.startDate)) return next

  if (form.allDay) {
    // Slutet är exklusivt, så antalet dagar efter första dagen är ett färre än avståndet.
    const span = daysBetweenDateStrings(reference.start, reference.end) - 1
    return { ...next, endDate: addDaysToDateString(next.startDate, span) }
  }

  if (!isTimeString(next.startTime)) return next
  const duration = Date.parse(reference.end) - Date.parse(reference.start)
  const newStart = Date.parse(wallTimeToRfc3339(next.startDate, next.startTime, timeZone))
  const newEnd = new Date(newStart + duration)
  return {
    ...next,
    endDate: dateStringInZone(newEnd, timeZone),
    endTime: timeStringInZone(newEnd, timeZone),
  }
}
