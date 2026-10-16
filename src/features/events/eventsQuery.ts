import type { DateRange } from '@/lib/dates'
import { toRfc3339 } from '@/lib/dates'
import { listEvents, type EventsResult, type GoogleReader } from '@/lib/google'
import { queryKeys } from './queryKeys'

/** Hur ofta öppna perioder hämtas om. Pausas när fliken är dold (TanStack Querys standard). */
export const EVENTS_POLL_INTERVAL_MS = 60_000

export interface EventsQueryParams {
  calendarId: string
  range: DateRange
  timeZone: string
}

/**
 * En kalenders händelser i ett intervall. Delas av `useEventsForCalendars` och förhämtningen, så att
 * båda använder samma cache-post.
 */
export function eventsQuery(
  client: GoogleReader,
  { calendarId, range, timeZone }: EventsQueryParams,
) {
  return {
    queryKey: queryKeys.eventsInRange(
      calendarId,
      toRfc3339(range.start, timeZone),
      toRfc3339(range.end, timeZone),
      timeZone,
    ),
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<EventsResult> =>
      listEvents(
        client,
        { calendarId, timeMin: range.start, timeMax: range.end, timeZone },
        { signal },
      ),
  }
}
