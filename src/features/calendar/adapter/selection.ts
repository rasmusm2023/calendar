import { addDaysToDateString, toRfc3339 } from '@/lib/dates'
import type { EventTime } from '@/lib/google'

/** Det vi behöver av FullCalendars `select`-argument (en dragning i rutnätet). */
export interface SelectionArg {
  start: Date
  end: Date
  allDay: boolean
  startStr: string
  endStr: string
}

/** Det vi behöver av FullCalendars `dateClick`-argument (ett klick i rutnätet). */
export interface DateClickArg {
  date: Date
  allDay: boolean
  dateStr: string
}

/** Längden på en händelse som skapas med ett enkelt klick (PRD 6.4: standardlängd 1 h). */
export const CLICK_EVENT_DURATION_MS = 60 * 60 * 1000

/** Datumdelen ("YYYY-MM-DD") av FullCalendars datumsträng. För heldag finns inget klockslag, men var säker. */
function datePart(value: string): string {
  return value.slice(0, 10)
}

/**
 * Dragningen i rutnätet som en tid för en ny händelse. Heldag ger rena datum med exklusivt slut, som
 * hos Google. Tidsbestämd ger exakta tider med offset i `timeZone`. Det här är gränsen mot FullCalendar:
 * utanför adaptern finns bara `EventTime`.
 */
export function eventTimeFromSelection(arg: SelectionArg, timeZone: string): EventTime {
  if (arg.allDay) {
    return { start: datePart(arg.startStr), end: datePart(arg.endStr), allDay: true }
  }
  return {
    start: toRfc3339(arg.start, timeZone),
    end: toRfc3339(arg.end, timeZone),
    allDay: false,
  }
}

/** Ett klick som en tid för en ny händelse: en timme för tidsbestämd, en dag för heldag. */
export function eventTimeFromClick(arg: DateClickArg, timeZone: string): EventTime {
  if (arg.allDay) {
    const start = datePart(arg.dateStr)
    return { start, end: addDaysToDateString(start, 1), allDay: true }
  }
  return {
    start: toRfc3339(arg.date, timeZone),
    end: toRfc3339(new Date(arg.date.getTime() + CLICK_EVENT_DURATION_MS), timeZone),
    allDay: false,
  }
}
