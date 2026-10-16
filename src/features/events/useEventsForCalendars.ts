import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useGoogleAccess } from '@/features/google-access'
import { toRfc3339, type DateRange } from '@/lib/dates'
import {
  GoogleAccessError,
  GoogleApiError,
  listEvents,
  type CalendarFailure,
  type EventsResult,
  type ParseIssue,
} from '@/lib/google'
import type { CalendarInfo, CalEvent } from '@/types'
import { queryKeys } from './queryKeys'

export interface UseEventsParams {
  /** De kalendrar som ska visas. Bara `id` används. */
  calendars: readonly Pick<CalendarInfo, 'id'>[]
  range: DateRange
  /** Användarens tidszon. Google skickar tider med den zonens offset. */
  timeZone: string
  enabled?: boolean
}

export interface EventsForCalendars {
  /** Händelser från de kalendrar som hunnit hämtas, i kalendrarnas ordning. */
  events: CalEvent[]
  issues: (ParseIssue & { calendarId: string })[]
  /** Kalendrar som inte gick att hämta alls. De övriga visas ändå. */
  failures: CalendarFailure[]
  /** Kalendrar som redan har data men vars senaste uppdatering misslyckades. Datan visas, men kan vara gammal. */
  refreshFailures: CalendarFailure[]
  truncatedCalendarIds: string[]
  /** Problem med själva åtkomsten (t.ex. återkallad). Drabbar alla kalendrar. */
  accessError: GoogleAccessError | null
  /** Minst en kalender väntar på sin första data. Övriga händelser kan redan visas. */
  isPending: boolean
  /** Något hämtas just nu, även bakgrundsuppdateringar. */
  isFetching: boolean
  /** Hämta om alla kalendrar. */
  refetch: () => void
}

const SEPARATOR = '\n'

/**
 * Händelser för flera kalendrar och ett intervall. Varje kalender och intervall har en egen
 * cache-post, så att en kalender som misslyckas inte stoppar de andra och att byte av vecka
 * återanvänder redan hämtad data.
 */
export function useEventsForCalendars({
  calendars,
  range,
  timeZone,
  enabled = true,
}: UseEventsParams): EventsForCalendars {
  const { client } = useGoogleAccess()

  // Kalenderlistan kan vara en ny array vid varje rendering. Nyckeln gör att vi bara byter när id:na byts.
  const idsKey = calendars.map((calendar) => calendar.id).join(SEPARATOR)
  const calendarIds = useMemo(() => (idsKey === '' ? [] : idsKey.split(SEPARATOR)), [idsKey])

  const rangeStart = toRfc3339(range.start, timeZone)
  const rangeEnd = toRfc3339(range.end, timeZone)

  const combine = useCallback(
    (results: UseQueryResult<EventsResult>[]): EventsForCalendars => {
      const merged: EventsForCalendars = {
        events: [],
        issues: [],
        failures: [],
        refreshFailures: [],
        truncatedCalendarIds: [],
        accessError: null,
        isPending: results.some((result) => result.isPending),
        isFetching: results.some((result) => result.isFetching),
        refetch: () => {
          results.forEach((result) => {
            void result.refetch()
          })
        },
      }

      results.forEach((result, index) => {
        const calendarId = calendarIds[index]
        if (calendarId === undefined) return

        if (result.data) {
          merged.events.push(...result.data.events)
          merged.issues.push(...result.data.issues.map((issue) => ({ ...issue, calendarId })))
          if (result.data.truncated) merged.truncatedCalendarIds.push(calendarId)
        }
        if (result.error instanceof GoogleApiError) {
          const failure = { calendarId, error: result.error }
          if (result.data) merged.refreshFailures.push(failure)
          else merged.failures.push(failure)
        } else if (result.error instanceof GoogleAccessError) {
          merged.accessError ??= result.error
        }
      })
      return merged
    },
    [calendarIds],
  )

  return useQueries({
    queries: calendarIds.map((calendarId) => ({
      queryKey: queryKeys.eventsInRange(calendarId, rangeStart, rangeEnd, timeZone),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listEvents(
          client,
          { calendarId, timeMin: range.start, timeMax: range.end, timeZone },
          { signal },
        ),
      enabled,
    })),
    combine,
  })
}
