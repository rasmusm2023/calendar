import type { EventTime } from '@/lib/google'
import type { CalEvent } from '@/types'
import type { CreateEventInput } from './createEventCommand'

/**
 * Det som behövs för att skapa en kopia av en händelse: alla fält utom id och etag. Kopian får egen tid om
 * `time` anges (Alt+dra), annars samma tid. Används för att duplicera och för att ångra en borttagning, eftersom
 * Google inte låter ett borttaget id användas igen.
 */
export function createInputFromEvent(event: CalEvent, time?: EventTime): CreateEventInput {
  const { start, end, allDay } = time ?? event
  return {
    calendarId: event.calendarId,
    title: event.title,
    start,
    end,
    allDay,
    ...(event.location !== undefined && { location: event.location }),
    ...(event.description !== undefined && { description: event.description }),
    ...(event.reminders !== undefined && { reminders: event.reminders }),
    ...(event.familyId !== undefined && { familyId: event.familyId }),
    important: event.important,
  }
}
