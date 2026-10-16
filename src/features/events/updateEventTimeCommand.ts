import type { EventTime } from '@/lib/google'
import type { UndoCommand } from '@/lib/undo'
import { updateEventCommand, type UpdateEventContext } from './updateEventCommand'

export interface UpdateEventTimeInput {
  calendarId: string
  eventId: string
  /** Tiden händelsen hade innan ändringen. Det som ångra och återställning går tillbaka till. */
  from: EventTime
  /** Den nya tiden. */
  to: EventTime
}

export type UpdateEventTimeContext = UpdateEventContext

/**
 * Kommando för att flytta eller ändra längd på en händelse. Båda ändrar bara start, slut och heldag, och
 * tidsändringar kan slås ihop så att bara den sista skickas (PRD 6.4: senaste ändringen vinner).
 * Se `updateEventCommand` för hur etag, cache och fel hanteras.
 */
export function updateEventTimeCommand(
  context: UpdateEventTimeContext,
  input: UpdateEventTimeInput,
): UndoCommand {
  return updateEventCommand(context, {
    calendarId: input.calendarId,
    eventId: input.eventId,
    from: { time: input.from },
    to: { time: input.to },
  })
}
