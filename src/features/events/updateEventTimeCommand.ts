import type { QueryClient } from '@tanstack/react-query'
import { patchEvent, type EventTime, type GoogleClient } from '@/lib/google'
import type { CommandStep, UndoCommand } from '@/lib/undo'
import {
  cancelEventQueries,
  findEventInCache,
  refreshCalendarEvents,
  updateEventInCache,
  addEventToCache,
} from './eventsCache'

export interface UpdateEventTimeInput {
  calendarId: string
  eventId: string
  /** Tiden händelsen hade innan ändringen. Det som ångra och återställning går tillbaka till. */
  from: EventTime
  /** Den nya tiden. */
  to: EventTime
}

export interface UpdateEventTimeContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Flytta Gympass". */
  label: string
}

function sameTime(a: EventTime, b: EventTime): boolean {
  return a.start === b.start && a.end === b.end && a.allDay === b.allDay
}

/**
 * Kommando för att flytta eller ändra längd på en händelse (PROJECT.md §5.3). Ett kommando för båda, eftersom
 * båda bara ändrar start, slut och heldag.
 *
 * - Stegen är absoluta ("tiden ska vara X") och kan slås ihop (`coalesce`): drar användaren om en händelse
 *   flera gånger medan ett anrop pågår skickas bara den sista tiden.
 * - Etag läses ur cachen när anropet skickas, inte när användaren släppte. Annars skulle en andra ändring av
 *   samma händelse få 412 av Google, eftersom den första ändringen redan gett händelsen en ny etag.
 * - Svaret från Google skrivs bara in i cachen om ingen senare ändring väntar. Annars hoppar händelsen
 *   tillbaka till den äldre positionen en stund (flicker). Då uppdateras bara etag.
 * - Vid fel återställs tiden och händelsen hämtas om från Google, så att det vi visar är det som gäller
 *   (t.ex. vid 412 när någon annan ändrat händelsen).
 */
export function updateEventTimeCommand(
  context: UpdateEventTimeContext,
  input: UpdateEventTimeInput,
): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const { calendarId, eventId } = input
  const ref = { calendarId, eventId }

  const timeStep = (target: EventTime, previous: EventTime): CommandStep => ({
    optimistic: () => {
      cancelEventQueries(queryClient, calendarId)
      updateEventInCache(queryClient, ref, target)
    },
    apply: async () => {
      // Ett tomt etag är en händelse som ännu inte bekräftats av Google (skapad nyss). Då skickas inget If-Match.
      const etag = findEventInCache(queryClient, ref)?.etag
      const confirmed = await patchEvent(
        client,
        ref,
        { time: target },
        { timeZone, ...(etag !== undefined && etag !== '' && { etag }) },
      )
      const current = findEventInCache(queryClient, ref)
      if (current === undefined || sameTime(current, target)) {
        addEventToCache(queryClient, confirmed)
        refreshCalendarEvents(queryClient, calendarId)
      } else {
        updateEventInCache(queryClient, ref, { etag: confirmed.etag })
      }
    },
    rollback: () => {
      updateEventInCache(queryClient, ref, previous)
      refreshCalendarEvents(queryClient, calendarId)
    },
  })

  return {
    label,
    key: `${calendarId}/${eventId}`,
    announce: true,
    coalesce: true,
    forward: timeStep(input.to, input.from),
    backward: timeStep(input.from, input.to),
  }
}
