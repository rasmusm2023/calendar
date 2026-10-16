import type { CalendarInfo } from '@/types'

/** Kalendrar där man får skapa och ändra händelser (ägare eller skrivrätt). */
export function isWritableCalendar(calendar: Pick<CalendarInfo, 'accessRole'>): boolean {
  return calendar.accessRole === 'owner' || calendar.accessRole === 'writer'
}

/**
 * Kalendern som en ny händelse hamnar i från början: huvudkalendern om den är synlig, annars första synliga
 * kalendern man får skriva i, och först därefter något av de andra. Det man ser är oftast det man
 * vill lägga till i. `undefined` om man inte får skriva i någon kalender.
 */
export function pickDefaultCalendarId(
  calendars: readonly CalendarInfo[],
  visibleIds: ReadonlySet<string>,
): string | undefined {
  const writable = calendars.filter(isWritableCalendar)
  const visible = writable.filter((calendar) => visibleIds.has(calendar.id))
  return (
    visible.find((calendar) => calendar.primary)?.id ??
    visible[0]?.id ??
    writable.find((calendar) => calendar.primary)?.id ??
    writable[0]?.id
  )
}
