import type { EventInput } from '@fullcalendar/core'
import { resolveEventStyle, type StyleContext } from '@/features/events'
import type { CalEvent } from '@/types'

/** FullCalendar behöver ett id som är unikt över alla kalendrar. Händelse-id är bara unika per kalender. */
export function toFullCalendarId(event: Pick<CalEvent, 'calendarId' | 'id'>): string {
  return `${event.calendarId}/${event.id}`
}

/**
 * Översätter våra händelser till FullCalendars format. Det här är enda stället där vår CalEvent möter
 * FullCalendars EventInput. Färgen räknas ut här via resolveEventStyle och lagras inte på händelsen.
 *
 * Tiderna är ISO-strängar och går vidare utan omräkning. För heldagar är `end` exklusivt hos både Google och
 * FullCalendar.
 */
export function toFullCalendarEvents(
  events: readonly CalEvent[],
  styleContext: StyleContext,
): EventInput[] {
  return events.map((event) => {
    const style = resolveEventStyle(event, styleContext)
    return {
      id: toFullCalendarId(event),
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      backgroundColor: style.bg,
      borderColor: style.border,
      textColor: style.text,
      editable: false,
      extendedProps: { calendarId: event.calendarId, eventId: event.id },
    }
  })
}
