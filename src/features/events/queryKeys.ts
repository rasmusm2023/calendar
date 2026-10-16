/**
 * Nycklar för TanStack Query (PROJECT.md §5). `['events', calendarId]` räcker för att ogiltigförklara
 * en hel kalender, `['events']` för alla händelser.
 */
export const queryKeys = {
  calendars: ['calendars'] as const,
  events: ['events'] as const,
  eventsInRange: (calendarId: string, rangeStart: string, rangeEnd: string, timeZone: string) =>
    ['events', calendarId, rangeStart, rangeEnd, timeZone] as const,
}
