import type { EventChanges, EventTime } from '@/lib/google'
import type { CalEvent, EventReminders } from '@/types'

/**
 * Fält på en befintlig händelse som kan ändras tillsammans (redigeringspanelen, och flytta/ändra längd som bara
 * ändrar `time`). Det som utelämnas rörs inte. Tom text i `location` och `description` betyder "ingen".
 *
 * Beskriver alltid ett absolut slutläge ("titeln ska vara X"), aldrig en relativ ändring. Det är vad ångra och
 * ihopslagning av ändringar kräver (se `CommandStep`).
 */
export interface EventEdit {
  title?: string
  location?: string
  description?: string
  time?: EventTime
  reminders?: EventReminders
}

/** Fälten i `EventEdit`, i den ordning de skrivs. */
export const EDIT_KEYS = ['title', 'location', 'description', 'time', 'reminders'] as const

function sameTime(a: EventTime, b: EventTime): boolean {
  return a.start === b.start && a.end === b.end && a.allDay === b.allDay
}

/** Påminnelser jämförs med innehåll. Ordningen på listan är oväsentlig. */
export function sameReminders(a: EventReminders, b: EventReminders): boolean {
  if (a.useDefault || b.useDefault) return a.useDefault === b.useDefault
  const key = (r: { method: string; minutes: number }) => `${r.method}:${String(r.minutes)}`
  const left = a.overrides.map(key).toSorted()
  const right = b.overrides.map(key).toSorted()
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Händelsens påminnelser. Skickar Google inga betyder det kalenderns standard. */
export function remindersOf(event: CalEvent): EventReminders {
  return event.reminders ?? { useDefault: true }
}

/** Händelsen med ändringarna gjorda. Tom text tar bort plats och beskrivning. */
export function applyEdit(event: CalEvent, edit: EventEdit): CalEvent {
  const next: CalEvent = { ...event }
  if (edit.title !== undefined) next.title = edit.title
  if (edit.time !== undefined) {
    next.start = edit.time.start
    next.end = edit.time.end
    next.allDay = edit.time.allDay
  }
  if (edit.location !== undefined) {
    if (edit.location === '') delete next.location
    else next.location = edit.location
  }
  if (edit.description !== undefined) {
    if (edit.description === '') delete next.description
    else next.description = edit.description
  }
  if (edit.reminders !== undefined) next.reminders = edit.reminders
  return next
}

/** Händelsens nuvarande värden för fälten som `edit` rör. Det som ångra går tillbaka till. */
export function editBefore(event: CalEvent, edit: EventEdit): EventEdit {
  const before: EventEdit = {}
  if (edit.title !== undefined) before.title = event.title
  if (edit.location !== undefined) before.location = event.location ?? ''
  if (edit.description !== undefined) before.description = event.description ?? ''
  if (edit.time !== undefined) {
    before.time = { start: event.start, end: event.end, allDay: event.allDay }
  }
  if (edit.reminders !== undefined) before.reminders = remindersOf(event)
  return before
}

/** Har händelsen redan alla värden som `edit` anger? */
export function matchesEdit(event: CalEvent, edit: EventEdit): boolean {
  return (
    (edit.title === undefined || event.title === edit.title) &&
    (edit.location === undefined || (event.location ?? '') === edit.location) &&
    (edit.description === undefined || (event.description ?? '') === edit.description) &&
    (edit.time === undefined ||
      sameTime({ start: event.start, end: event.end, allDay: event.allDay }, edit.time)) &&
    (edit.reminders === undefined || sameReminders(remindersOf(event), edit.reminders))
  )
}

/** Ändringen som ett PATCH-anrop mot Google. Tom plats och beskrivning rensas med `null`. */
export function changesForGoogle(edit: EventEdit): EventChanges {
  return {
    ...(edit.title !== undefined && { title: edit.title }),
    ...(edit.location !== undefined && { location: edit.location === '' ? null : edit.location }),
    ...(edit.description !== undefined && {
      description: edit.description === '' ? null : edit.description,
    }),
    ...(edit.time !== undefined && { time: edit.time }),
    ...(edit.reminders !== undefined && { reminders: edit.reminders }),
  }
}

/** Är det bara tiden som ändras? Då får ändringen slås ihop med en tidigare tidsändring (se `coalesce`). */
export function isTimeOnly(edit: EventEdit): boolean {
  return EDIT_KEYS.every((key) => key === 'time' || edit[key] === undefined)
}
