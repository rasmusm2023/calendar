import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useGoogleAccess } from '@/features/google-access'
import { listCalendars, type CalendarListResult } from '@/lib/google'
import { queryKeys } from './queryKeys'

const FIVE_MINUTES_MS = 5 * 60_000

/** Användarens Google-kalendrar. Hämtas från Google och sparas aldrig i Firestore. */
export function useCalendars(): UseQueryResult<CalendarListResult> {
  const { client } = useGoogleAccess()

  return useQuery({
    queryKey: queryKeys.calendars,
    queryFn: ({ signal }) => listCalendars(client, { signal }),
    // Kalenderlistan ändras sällan, så den behöver inte hämtas om lika ofta som händelser.
    staleTime: FIVE_MINUTES_MS,
  })
}
