import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useGoogleAccess } from '@/features/google-access'
import { toRfc3339, type DateRange } from '@/lib/dates'
import type { CalendarInfo } from '@/types'
import { eventsQuery } from './eventsQuery'
import { useCalendarIds } from './useCalendarIds'

/** Fel vid förhämtning ignoreras: öppnas perioden försöker den vanliga hämtningen igen och visar felet. */
function ignoreError(): void {
  return undefined
}

/** Väntan innan förhämtningen startar. Snabb bläddring ska inte köa upp anrop framför den öppna perioden. */
export const PREFETCH_DELAY_MS = 300

export interface UsePrefetchEventsParams {
  calendars: readonly Pick<CalendarInfo, 'id'>[]
  /** Perioder som sannolikt öppnas härnäst, i prioritetsordning. */
  ranges: readonly DateRange[]
  timeZone: string
  /** Sätt till falskt medan den öppna perioden hämtas, så att den får gå före. */
  enabled?: boolean
}

/**
 * Hämtar grannperioderna i bakgrunden så att bläddring känns omedelbar. Datan hamnar i samma cache-post
 * som `useEventsForCalendars` läser. Färsk data hämtas inte om, och fel ignoreras här: öppnas perioden
 * försöker den vanliga hämtningen igen och visar felet.
 */
export function usePrefetchEvents({
  calendars,
  ranges,
  timeZone,
  enabled = true,
}: UsePrefetchEventsParams): void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const calendarIds = useCalendarIds(calendars)

  // Intervallen kommer ofta som nya objekt vid varje rendering. Nyckeln gör att effekten bara körs om
  // när något faktiskt ändrats.
  const rangesKey = ranges
    .map((range) => `${toRfc3339(range.start, timeZone)}|${toRfc3339(range.end, timeZone)}`)
    .join('\n')

  useEffect(() => {
    if (!enabled || calendarIds.length === 0 || ranges.length === 0) return

    const timer = setTimeout(() => {
      for (const range of ranges) {
        for (const calendarId of calendarIds) {
          queryClient.query(eventsQuery(client, { calendarId, range, timeZone })).catch(ignoreError)
        }
      }
    }, PREFETCH_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
    // `ranges` ersätts av `rangesKey`: samma intervall ger samma nyckel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, calendarIds, rangesKey, timeZone, client, queryClient])
}
