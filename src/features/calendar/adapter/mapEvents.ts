import type { EventInput } from '@fullcalendar/core'
import { resolveEventStyle, type StyleContext } from '@/features/events'
import type { EventTime } from '@/lib/google'
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
  untitledLabel = '',
): EventInput[] {
  return events.map((event) => {
    const style = resolveEventStyle(event, styleContext)
    return {
      id: toFullCalendarId(event),
      title: event.title === '' ? untitledLabel : event.title,
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

/** Id för utkastet (händelsen som håller på att skapas). Börjar inte med en kalender, så det kan inte krocka med en riktig. */
export const DRAFT_EVENT_ID = 'sc-draft'

/** Klassen som utkastet får, för stil och för att hitta det i DOM:en. */
export const DRAFT_CLASS = 'sc-draft'

export interface GridDraft {
  time: EventTime
  /** Kalendern utkastet ritas i färgen av. */
  calendarId: string
  title: string
}

/**
 * Utkastet som en händelse i rutnätet, i vald kalenders färg. Det är bara en markering av var den nya händelsen
 * hamnar medan popovern är öppen: det går inte att klicka på eller flytta, och det finns inte i någon cache.
 */
export function toFullCalendarDraft(draft: GridDraft, styleContext: StyleContext): EventInput {
  const style = resolveEventStyle(
    {
      id: DRAFT_EVENT_ID,
      calendarId: draft.calendarId,
      etag: '',
      title: draft.title,
      start: draft.time.start,
      end: draft.time.end,
      allDay: draft.time.allDay,
      important: false,
    },
    styleContext,
  )
  return {
    id: DRAFT_EVENT_ID,
    title: draft.title,
    start: draft.time.start,
    end: draft.time.end,
    allDay: draft.time.allDay,
    backgroundColor: style.bg,
    borderColor: style.border,
    textColor: style.text,
    classNames: [DRAFT_CLASS],
    editable: false,
    extendedProps: { isDraft: true },
  }
}
