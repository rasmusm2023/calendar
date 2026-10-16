import type { QueryClient } from '@tanstack/react-query'
import { patchEvent, type GoogleClient } from '@/lib/google'
import type { CommandStep, UndoCommand } from '@/lib/undo'
import { applyEdit, changesForGoogle, isTimeOnly, matchesEdit, type EventEdit } from './eventEdit'
import {
  addEventToCache,
  cancelEventQueries,
  findEventInCache,
  refreshCalendarEvents,
  updateEventInCache,
} from './eventsCache'

export interface UpdateEventInput {
  calendarId: string
  eventId: string
  /** Värdena före ändringen, för de fält som ändras. Det som ångra och återställning går tillbaka till. */
  from: EventEdit
  /** De nya värdena. */
  to: EventEdit
}

export interface UpdateEventContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Flytta Gympass". */
  label: string
}

/**
 * Kommando för att ändra en befintlig händelse (PROJECT.md §5.3): flytta, ändra längd och redigering i panelen.
 *
 * - Stegen är absoluta ("fälten ska vara X") och bara tidsändringar kan slås ihop (`coalesce`): drar användaren
 *   om en händelse flera gånger medan ett anrop pågår skickas bara den sista tiden. Ändringar av andra fält slås
 *   aldrig ihop, för då skulle en titeländring kunna försvinna när en senare flytt ersätter den.
 * - Etag läses ur cachen när anropet skickas, inte när användaren släppte. Annars skulle en andra ändring av
 *   samma händelse få 412 av Google, eftersom den första ändringen redan gett händelsen en ny etag.
 * - Svaret från Google skrivs bara in i cachen om ingen senare ändring väntar. Annars hoppar händelsen
 *   tillbaka till det äldre läget en stund (flicker). Då uppdateras bara etag.
 * - Vid fel återställs fälten och händelsen hämtas om från Google, så att det vi visar är det som gäller
 *   (t.ex. vid 412 när någon annan ändrat händelsen).
 */
export function updateEventCommand(
  context: UpdateEventContext,
  input: UpdateEventInput,
): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const { calendarId, eventId } = input
  const ref = { calendarId, eventId }

  /** Lägger in `edit` i händelsen i cachen. Finns den inte där görs ingenting. */
  const applyToCache = (edit: EventEdit) => {
    const current = findEventInCache(queryClient, ref)
    if (current !== undefined) addEventToCache(queryClient, applyEdit(current, edit))
  }

  const step = (target: EventEdit, previous: EventEdit): CommandStep => ({
    optimistic: () => {
      cancelEventQueries(queryClient, calendarId)
      applyToCache(target)
    },
    apply: async () => {
      // Ett tomt etag är en händelse som ännu inte bekräftats av Google (skapad nyss). Då skickas inget If-Match.
      const etag = findEventInCache(queryClient, ref)?.etag
      const confirmed = await patchEvent(client, ref, changesForGoogle(target), {
        timeZone,
        ...(etag !== undefined && etag !== '' && { etag }),
      })
      const current = findEventInCache(queryClient, ref)
      if (current === undefined || matchesEdit(current, target)) {
        addEventToCache(queryClient, confirmed)
        refreshCalendarEvents(queryClient, calendarId)
      } else {
        updateEventInCache(queryClient, ref, { etag: confirmed.etag })
      }
    },
    rollback: () => {
      applyToCache(previous)
      refreshCalendarEvents(queryClient, calendarId)
    },
  })

  return {
    label,
    key: `${calendarId}/${eventId}`,
    announce: true,
    coalesce: isTimeOnly(input.to),
    forward: step(input.to, input.from),
    backward: step(input.from, input.to),
  }
}
