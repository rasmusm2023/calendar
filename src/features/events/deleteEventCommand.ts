import type { QueryClient } from '@tanstack/react-query'
import { deleteEvent, generateEventId, insertEvent, type GoogleClient } from '@/lib/google'
import type { UndoCommand } from '@/lib/undo'
import type { CalEvent } from '@/types'
import { createInputFromEvent } from './eventCopy'
import {
  addEventToCache,
  cancelEventQueries,
  refreshCalendarEvents,
  removeEventFromCache,
} from './eventsCache'

export interface DeleteEventContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Ta bort Gympass". */
  label: string
  /** Nytt id för en återställd händelse. Byts ut i tester. */
  newId?: () => string
}

/**
 * Kommando för att ta bort en händelse, med ångra (PRD 6.3).
 *
 * Händelsen försvinner direkt och tas bort hos Google i bakgrunden. Google låter inte ett borttaget id
 * användas igen, så ångra skapar en kopia med samma innehåll och ett nytt id (`createInputFromEvent`).
 * Gör man om borttagningen därefter tas kopian bort, så kommandot håller reda på vilken händelse det gäller just nu.
 *
 * Borttagningen skickas utan If-Match: den som tar bort något vill ha bort det, även om någon annan hunnit
 * ändra det. Raderas den redan hos Google (404/410) räknas det som lyckat.
 */
export function deleteEventCommand(context: DeleteEventContext, event: CalEvent): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const newId = context.newId ?? generateEventId

  /** Händelsen som den finns just nu: först den som togs bort, efter ångra kopian. */
  let current = event
  /** Id för kopian som ångra håller på att skapa. Sparas så att ett nytt försök efter fel återanvänder det. */
  let restoreId: string | null = null
  const ref = (target: CalEvent) => ({ calendarId: target.calendarId, eventId: target.id })

  const optimisticCopy = (id: string): CalEvent => ({ ...current, id, etag: '' })

  return {
    label,
    key: `${event.calendarId}/${event.id}`,
    announce: true,
    forward: {
      optimistic: () => {
        cancelEventQueries(queryClient, current.calendarId)
        removeEventFromCache(queryClient, ref(current))
      },
      apply: async () => {
        await deleteEvent(client, ref(current))
        refreshCalendarEvents(queryClient, current.calendarId)
      },
      rollback: () => {
        addEventToCache(queryClient, current)
      },
    },
    backward: {
      optimistic: () => {
        restoreId ??= newId()
        cancelEventQueries(queryClient, current.calendarId)
        addEventToCache(queryClient, optimisticCopy(restoreId))
      },
      apply: async () => {
        if (restoreId === null) return
        const restored = await insertEvent(
          client,
          { id: restoreId, ...createInputFromEvent(current) },
          { timeZone },
        )
        current = restored
        restoreId = null
        addEventToCache(queryClient, restored)
        refreshCalendarEvents(queryClient, restored.calendarId)
      },
      rollback: () => {
        if (restoreId !== null) removeEventFromCache(queryClient, ref(optimisticCopy(restoreId)))
      },
    },
  }
}
