import { useMemo } from 'react'
import type { CalendarInfo } from '@/types'

const SEPARATOR = '\n'

/**
 * Kalender-id:na som en stabil array. Kalenderlistan kan vara en ny array vid varje rendering, så
 * arrayen byts bara när id:na byts.
 */
export function useCalendarIds(calendars: readonly Pick<CalendarInfo, 'id'>[]): string[] {
  const idsKey = calendars.map((calendar) => calendar.id).join(SEPARATOR)
  return useMemo(() => (idsKey === '' ? [] : idsKey.split(SEPARATOR)), [idsKey])
}
