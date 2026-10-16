import type { QueryClient } from '@tanstack/react-query'
import {
  deleteEvent,
  generateEventId,
  getEvent,
  insertEvent,
  patchEvent,
  truncateRecurrence,
  type GoogleClient,
} from '@/lib/google'
import type { UndoCommand } from '@/lib/undo'
import type { CalEvent } from '@/types'
import { createInputFromEvent } from './eventCopy'
import {
  cancelEventQueries,
  findSeriesInstances,
  refreshCalendarEvents,
  replaceEventsInCache,
} from './eventsCache'
import type { SeriesScope } from './recurringScope'
import { startMs } from './seriesTime'

export interface DeleteSeriesContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Ta bort Veckomöte". */
  label: string
  /** Nytt id för en återställd serie. Byts ut i tester. */
  newId?: () => string
}

export interface DeleteSeriesInput {
  /** Förekomsten användaren tog bort, som den såg ut i cachen. */
  instance: CalEvent
  /** `all` tar bort hela serien, `following` den här förekomsten och alla senare. */
  scope: SeriesScope
}

type UndoState =
  /** Hela serien är borta. Ångra skapar den på nytt (med nytt id). */
  | { kind: 'deleted'; master: CalEvent }
  /** Serien är avkortad. Ångra sätter tillbaka de gamla reglerna. */
  | { kind: 'truncated'; original: readonly string[] }

/**
 * Kommando för att ta bort en hel serie, eller en serie från en förekomst och framåt (PRD 6.7). Att ta bort bara en
 * förekomst går via `deleteEventCommand` på förekomstens id.
 *
 * - `all`, och `following` från seriens första förekomst: huvudhändelsen tas bort. Ångra skapar en kopia med
 *   samma regler och ett nytt id (Google låter inte ett borttaget id användas igen). Ändrade förekomster
 *   (undantag), deltagare och möteslänkar följer inte med.
 * - `following` annars: serien kortas av med UNTIL strax före förekomsten. Ångra sätter tillbaka reglerna.
 *
 * Inget If-Match, av samma skäl som i `deleteEventCommand`. Huvudhändelsen hämtas på nytt när ändringen skickas.
 */
export function deleteSeriesCommand(
  context: DeleteSeriesContext,
  input: DeleteSeriesInput,
): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const newId = context.newId ?? generateEventId
  const { instance, scope } = input
  const { calendarId } = instance
  const seriesId = instance.recurringEventId
  if (seriesId === undefined) throw new Error('Händelsen är ingen förekomst av en serie')

  const instanceStart = instance.originalStart ?? instance.start
  const affects = (candidate: CalEvent) =>
    scope === 'all' || startMs(candidate.originalStart ?? candidate.start) >= startMs(instanceStart)

  /** Huvudhändelsens id just nu: det ursprungliga, och efter ångra av en borttagning den nya kopian. */
  let masterId = seriesId
  let before: CalEvent[] = []
  let undoState: UndoState | null = null
  let restoreId: string | null = null

  return {
    label,
    key: `${calendarId}/${seriesId}`,
    announce: true,
    forward: {
      optimistic: () => {
        cancelEventQueries(queryClient, calendarId)
        before = findSeriesInstances(queryClient, calendarId, masterId).filter(affects)
        replaceEventsInCache(queryClient, before, [])
      },
      apply: async () => {
        const ref = { calendarId, eventId: masterId }
        const master = await getEvent(client, ref, { timeZone })
        if (scope === 'all' || startMs(instanceStart) <= startMs(master.start)) {
          await deleteEvent(client, ref)
          undoState = { kind: 'deleted', master }
        } else {
          const original = master.recurrence ?? []
          await patchEvent(
            client,
            ref,
            { recurrence: truncateRecurrence(original, instanceStart, master.allDay) },
            { timeZone },
          )
          undoState = { kind: 'truncated', original }
        }
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        replaceEventsInCache(queryClient, [], before)
        refreshCalendarEvents(queryClient, calendarId)
      },
    },
    backward: {
      optimistic: () => {
        cancelEventQueries(queryClient, calendarId)
        replaceEventsInCache(queryClient, [], before)
      },
      apply: async () => {
        if (undoState === null) return
        if (undoState.kind === 'truncated') {
          await patchEvent(
            client,
            { calendarId, eventId: masterId },
            { recurrence: undoState.original },
            { timeZone },
          )
        } else {
          restoreId ??= newId()
          const { master } = undoState
          const restored = await insertEvent(
            client,
            {
              id: restoreId,
              ...createInputFromEvent(master),
              recurrence: master.recurrence ?? [],
              ...(!master.allDay && { timeZone: master.timeZone ?? timeZone }),
            },
            { timeZone },
          )
          masterId = restored.id
          restoreId = null
          undoState = { kind: 'deleted', master: restored }
        }
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        replaceEventsInCache(queryClient, before, [])
        refreshCalendarEvents(queryClient, calendarId)
      },
    },
  }
}
