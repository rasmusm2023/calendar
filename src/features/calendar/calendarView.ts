import { z } from 'zod'
import {
  addDaysInZone,
  addMonthsInZone,
  dayRange,
  monthGridRange,
  weekRange,
  type DateRange,
} from '@/lib/dates'

/** Vyerna i PRD 6.2: dag, vecka, N dagar, månad och schema (agenda). */
export const CALENDAR_VIEW_KINDS = ['day', 'week', 'days', 'month', 'agenda'] as const
export type CalendarViewKind = (typeof CALENDAR_VIEW_KINDS)[number]

export const MIN_DAYS = 2
export const MAX_DAYS = 14
export const DEFAULT_DAYS = 3
/** Schemat visar så här många dygn från den valda dagen. */
export const AGENDA_DAYS = 30

export interface CalendarView {
  kind: CalendarViewKind
  /** Antal dagar i vyn "N dagar" (2–14). Används bara när `kind` är `days`. */
  days: number
}

export const DEFAULT_VIEW: CalendarView = { kind: 'week', days: DEFAULT_DAYS }

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(days)))
}

/**
 * Intervallet som vyn visar och som vi hämtar händelser för, som [start, slut). Är samma sak som det
 * FullCalendar ritar (adaptern ger FullCalendar exakt det här intervallet), så att det aldrig hämtas för
 * mycket eller för lite. Månaden visar hela veckor, även dagar från grannmånaderna.
 */
export function visibleRange(view: CalendarView, anchor: Date, timeZone: string): DateRange {
  switch (view.kind) {
    case 'day':
      return dayRange(anchor, timeZone)
    case 'week':
      return weekRange(anchor, timeZone)
    case 'days':
      return dayRange(anchor, timeZone, clampDays(view.days))
    case 'month':
      return monthGridRange(anchor, timeZone)
    case 'agenda':
      return dayRange(anchor, timeZone, AGENDA_DAYS)
  }
}

/** Ankardatumet efter ett steg framåt (1) eller bakåt (-1): en period i taget, så som vyn är indelad. */
export function shiftAnchor(
  view: CalendarView,
  anchor: Date,
  direction: -1 | 1,
  timeZone: string,
): Date {
  const shifted = (() => {
    switch (view.kind) {
      case 'day':
        return addDaysInZone(anchor, direction, timeZone)
      case 'week':
        return addDaysInZone(anchor, direction * 7, timeZone)
      case 'days':
        return addDaysInZone(anchor, direction * clampDays(view.days), timeZone)
      case 'month':
        return addMonthsInZone(anchor, direction, timeZone)
      case 'agenda':
        return addDaysInZone(anchor, direction * AGENDA_DAYS, timeZone)
    }
  })()
  return new Date(shifted.getTime())
}

// ---- sparat val ----------------------------------------------------------------------------------

const viewSchema = z.object({
  kind: z.enum(CALENDAR_VIEW_KINDS),
  days: z.number().int().min(MIN_DAYS).max(MAX_DAYS).catch(DEFAULT_DAYS),
})

export type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>

function storageKey(uid: string): string {
  return `sc:calendarView:${uid}`
}

/** Användarens senast valda vy. Trasig eller saknad data ger standardvyn (veckan). */
export function loadView(storage: ViewStorage | null, uid: string): CalendarView {
  if (!storage) return DEFAULT_VIEW
  try {
    const raw = storage.getItem(storageKey(uid))
    if (raw === null) return DEFAULT_VIEW
    const parsed = viewSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

/** Sparar vyn lokalt per användare. Misslyckas lagringen gäller valet tills sidan laddas om. */
export function saveView(storage: ViewStorage | null, uid: string, view: CalendarView): void {
  try {
    storage?.setItem(storageKey(uid), JSON.stringify(view))
  } catch {
    // Se ovan.
  }
}
