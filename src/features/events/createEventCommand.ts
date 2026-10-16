import type { QueryClient } from '@tanstack/react-query'
import {
  deleteEvent,
  generateEventId,
  insertEvent,
  type EventTime,
  type GoogleClient,
} from '@/lib/google'
import type { UndoCommand } from '@/lib/undo'
import type { CalEvent, EventReminders } from '@/types'
import {
  addEventToCache,
  cancelEventQueries,
  refreshCalendarEvents,
  removeEventFromCache,
} from './eventsCache'

export interface CreateEventInput extends EventTime {
  calendarId: string
  title: string
  location?: string
  /** Följande används när en händelse kopieras (duplicera, ångra borttagning). */
  description?: string
  reminders?: EventReminders
  familyId?: string
  important?: boolean
}

/** Fälten som följer med in i en ny händelse, utan det som är unikt för den (id, etag). */
function extraFields(input: CreateEventInput) {
  return {
    ...(input.location !== undefined && { location: input.location }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.reminders !== undefined && { reminders: input.reminders }),
    ...(input.familyId !== undefined && { familyId: input.familyId }),
  }
}

export interface CreateEventContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Ny händelse: Gympass". */
  label: string
  /** Nytt id för varje skapande. Byts ut i tester. */
  newId?: () => string
}

/**
 * Kommando för att skapa en händelse, med ångra (PROJECT.md §5.3).
 *
 * Händelsen får sitt id här, innan den skickas, så att den optimistiska händelsen i cachen redan har det
 * id den får hos Google och inget byts ut när svaret kommer (ingen flimmer). Ett försök som körs om efter ett
 * fel använder samma id: Google svarar då 409 om den första ändå gick igenom, och `insertEvent` hämtar den
 * befintliga i stället för att göra en dubblett.
 *
 * Google tillåter inte att ett borttaget id används igen. Görs skapandet om efter en ångrad skapning
 * (gör om) får händelsen därför ett nytt id.
 */
export function createEventCommand(
  context: CreateEventContext,
  input: CreateEventInput,
): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const newId = context.newId ?? generateEventId
  const { calendarId } = input

  let eventId = newId()
  // Ändringar av samma händelse köas på `kalender/id` (se UndoCommand.key).
  const key = `${calendarId}/${eventId}`
  let needsNewId = false
  /** Händelsen som Google svarade med (har etag). Före dess används den optimistiska. */
  let confirmed: CalEvent | null = null

  const optimisticEvent = (): CalEvent => ({
    id: eventId,
    calendarId,
    etag: '',
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    ...extraFields(input),
    important: input.important === true,
  })

  const ref = () => ({ calendarId, eventId })

  return {
    label,
    key,
    announce: true,
    forward: {
      optimistic: () => {
        if (needsNewId) {
          eventId = newId()
          needsNewId = false
          confirmed = null
        }
        cancelEventQueries(queryClient, calendarId)
        addEventToCache(queryClient, confirmed ?? optimisticEvent())
      },
      apply: async () => {
        confirmed = await insertEvent(
          client,
          {
            id: eventId,
            calendarId,
            title: input.title,
            start: input.start,
            end: input.end,
            allDay: input.allDay,
            ...extraFields(input),
            ...(input.important !== undefined && { important: input.important }),
          },
          { timeZone },
        )
        addEventToCache(queryClient, confirmed)
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        removeEventFromCache(queryClient, ref())
      },
    },
    backward: {
      optimistic: () => {
        cancelEventQueries(queryClient, calendarId)
        removeEventFromCache(queryClient, ref())
      },
      apply: async () => {
        // Utan If-Match: att ångra ett skapande ska lyckas även om händelsen hunnit ändras.
        await deleteEvent(client, ref())
        needsNewId = true
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        addEventToCache(queryClient, confirmed ?? optimisticEvent())
      },
    },
  }
}
