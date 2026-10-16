import type { QueryClient } from '@tanstack/react-query'
import {
  continuationRules,
  countInstances,
  deleteEvent,
  generateEventId,
  getEvent,
  insertEvent,
  matchUntilToKind,
  patchEvent,
  ruleCount,
  shiftRecurrenceDays,
  truncateRecurrence,
  type EventChanges,
  type EventTime,
  type GoogleClient,
} from '@/lib/google'
import type { UndoCommand } from '@/lib/undo'
import type { CalEvent } from '@/types'
import { createInputFromEvent } from './eventCopy'
import { applyEdit, changesForGoogle, editBefore, type EventEdit } from './eventEdit'
import {
  cancelEventQueries,
  findSeriesInstances,
  refreshCalendarEvents,
  replaceEventsInCache,
} from './eventsCache'
import type { SeriesScope } from './recurringScope'
import { dayDelta, editForOccurrence, startMs, toInstant } from './seriesTime'

export interface UpdateSeriesContext {
  client: GoogleClient
  queryClient: QueryClient
  timeZone: string
  /** Redan översatt beskrivning av ändringen, t.ex. "Redigera Veckomöte". */
  label: string
  /** Nytt id för en serie som skapas när en serie delas. Byts ut i tester. */
  newId?: () => string
}

export interface UpdateSeriesInput {
  /** Förekomsten användaren ändrade, som den såg ut före ändringen. */
  instance: CalEvent
  /** `all` ändrar hela serien, `following` den här förekomsten och alla senare. */
  scope: SeriesScope
  /** De nya värdena, med tiden som den nya tiden för just den här förekomsten. */
  edit: EventEdit
}

/** Regeln som serien följer kan inte flyttas till en annan dag på ett säkert sätt (se `shiftRecurrenceDays`). */
export class CannotShiftSeriesError extends Error {
  constructor() {
    super('The recurrence rule cannot be moved to another day')
    this.name = 'CannotShiftSeriesError'
  }
}

/** Det som behövs för att ångra ändringen hos Google. */
type UndoState =
  | { kind: 'master'; restore: EventChanges }
  | { kind: 'split'; original: readonly string[]; newSeriesId: string }

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

/**
 * Kommando för att ändra en hel serie, eller en serie från en förekomst och framåt (PRD 6.7). Ändring av bara en
 * förekomst går via `updateEventCommand` på förekomstens id.
 *
 * - `all`: huvudhändelsen ändras. Flyttas en förekomst till en annan dag flyttas huvudhändelsen lika många dagar,
 *   och veckodagarna i regeln med. Klockslag och längd tas från den nya tiden.
 * - `following`: serien delas. En ny serie skapas från förekomsten med de nya värdena, och den gamla kortas av med
 *   UNTIL strax före förekomsten. Den nya skapas först, så att ett fel aldrig lämnar en lucka. Går avkortningen
 *   fel tas den nya bort igen. Är förekomsten serien första ändras hela serien i stället.
 *
 * Inget If-Match: ändringen gäller serien, och förekomstens etag säger inget om huvudhändelsens. Huvudhändelsen
 * hämtas i stället på nytt när ändringen skickas, och det som behövs för att ångra sparas då.
 *
 * Kända begränsningar vid `following`: undantag (ändrade förekomster) och EXDATE efter delningen följer inte med
 * till den nya serien, och Google skickar inga deltagare eller möteslänkar vidare.
 */
export function updateSeriesCommand(
  context: UpdateSeriesContext,
  input: UpdateSeriesInput,
): UndoCommand {
  const { client, queryClient, timeZone, label } = context
  const newId = context.newId ?? generateEventId
  const { instance, scope, edit } = input
  const { calendarId } = instance
  const seriesId = instance.recurringEventId
  if (seriesId === undefined) throw new Error('Händelsen är ingen förekomst av en serie')

  const masterRef = { calendarId, eventId: seriesId }
  const instanceStart = instance.originalStart ?? instance.start
  const delta = edit.time === undefined ? 0 : dayDelta(instance.start, edit.time.start)

  const affects = (candidate: CalEvent) =>
    scope === 'all' || startMs(candidate.originalStart ?? candidate.start) >= startMs(instanceStart)

  /** Förekomsterna i cachen som ändras, före och efter. Sparas så att ångra och återställning kan byta tillbaka. */
  let before: CalEvent[] = []
  let after: CalEvent[] = []
  let undoState: UndoState | null = null
  /** Id för serien som en delning skapar. Behålls mellan försök, så att ett nytt försök inte ger en dubblett. */
  let pendingId: string | null = null

  /** Hela serien (eller dess början) ändras genom att huvudhändelsen ändras. */
  const patchMaster = async (master: CalEvent): Promise<UndoState> => {
    const recurrence = master.recurrence ?? []
    const masterEdit = editForOccurrence(master.start, edit, delta, timeZone)
    let nextRecurrence = recurrence
    if (delta !== 0) {
      const shifted = shiftRecurrenceDays(recurrence, delta)
      if (shifted === null) throw new CannotShiftSeriesError()
      nextRecurrence = shifted
    }
    if (masterEdit.time !== undefined) {
      nextRecurrence = matchUntilToKind(nextRecurrence, masterEdit.time.allDay)
    }
    const recurrenceChanged = !sameLines(nextRecurrence, recurrence)
    const zone = master.timeZone ?? timeZone

    const forward: EventChanges = {
      ...changesForGoogle(masterEdit),
      ...(masterEdit.time !== undefined && { timeZone: zone }),
      ...(recurrenceChanged && { recurrence: nextRecurrence }),
    }
    const restore: EventChanges = {
      ...changesForGoogle(editBefore(master, masterEdit)),
      ...(masterEdit.time !== undefined && { timeZone: zone }),
      ...(recurrenceChanged && { recurrence }),
    }
    await patchEvent(client, masterRef, forward, { timeZone })
    return { kind: 'master', restore }
  }

  /** Delar serien vid förekomsten: ny serie från den, gamla serien kortas av. */
  const split = async (master: CalEvent): Promise<UndoState> => {
    const original = master.recurrence ?? []
    const count = ruleCount(original)
    let remaining: number | undefined
    if (count !== undefined) {
      const done = await countInstances(
        client,
        masterRef,
        { timeMin: toInstant(master.start, timeZone), timeMax: toInstant(instanceStart, timeZone) },
        {},
      )
      remaining = Math.max(1, count - done)
    }

    const target = applyEdit(instance, edit)
    const time: EventTime = { start: target.start, end: target.end, allDay: target.allDay }
    let rules = continuationRules(original, remaining)
    if (delta !== 0) {
      const shifted = shiftRecurrenceDays(rules, delta)
      if (shifted === null) throw new CannotShiftSeriesError()
      rules = shifted
    }
    rules = matchUntilToKind(rules, time.allDay)

    pendingId ??= newId()
    const id = pendingId
    await insertEvent(
      client,
      {
        id,
        ...createInputFromEvent(target),
        recurrence: rules,
        ...(!time.allDay && { timeZone: master.timeZone ?? timeZone }),
      },
      { timeZone },
    )
    try {
      await patchEvent(
        client,
        masterRef,
        { recurrence: truncateRecurrence(original, instanceStart, master.allDay) },
        { timeZone },
      )
    } catch (error) {
      // Avkortningen misslyckades: ta bort den nya serien så att inget dubbleras. Lyckas inte det heller
      // behålls id:t, så att ett nytt försök hittar den redan skapade serien i stället för att göra en till.
      try {
        await deleteEvent(client, { calendarId, eventId: id })
        pendingId = null
      } catch {
        // Felet från avkortningen är det som visas.
      }
      throw error
    }
    pendingId = null
    return { kind: 'split', original, newSeriesId: id }
  }

  const swap = (from: readonly CalEvent[], to: readonly CalEvent[]) => {
    cancelEventQueries(queryClient, calendarId)
    replaceEventsInCache(queryClient, from, to)
  }

  return {
    label,
    key: `${calendarId}/${seriesId}`,
    announce: true,
    forward: {
      optimistic: () => {
        before = findSeriesInstances(queryClient, calendarId, seriesId).filter(affects)
        after = before.map((event) =>
          applyEdit(event, editForOccurrence(event.start, edit, delta, timeZone)),
        )
        swap(before, after)
      },
      apply: async () => {
        const master = await getEvent(client, masterRef, { timeZone })
        const startsSeries = scope === 'all' || startMs(instanceStart) <= startMs(master.start)
        undoState = startsSeries ? await patchMaster(master) : await split(master)
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        swap(after, before)
        refreshCalendarEvents(queryClient, calendarId)
      },
    },
    backward: {
      optimistic: () => {
        swap(after, before)
      },
      apply: async () => {
        if (undoState === null) return
        if (undoState.kind === 'master') {
          await patchEvent(client, masterRef, undoState.restore, { timeZone })
        } else {
          await patchEvent(client, masterRef, { recurrence: undoState.original }, { timeZone })
          await deleteEvent(client, { calendarId, eventId: undoState.newSeriesId })
        }
        refreshCalendarEvents(queryClient, calendarId)
      },
      rollback: () => {
        swap(before, after)
        refreshCalendarEvents(queryClient, calendarId)
      },
    },
  }
}
