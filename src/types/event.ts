/**
 * Appens egen händelsetyp. Resten av appen arbetar bara med den här typen, aldrig med
 * Googles råa format eller FullCalendars (PROJECT.md §2). Händelsedata lagras aldrig i Firestore.
 *
 * Tider är ISO-strängar med tidszon (PROJECT.md §7):
 * - tidsbestämd: RFC 3339 med offset, t.ex. "2026-10-19T09:00:00+02:00"
 * - heldag: rent datum "2026-10-19". `end` är exklusivt, som hos Google (en heldag på en dag har
 *   end = nästa dag).
 */
/** En påminnelse på en händelse (Googles `reminders.overrides`). */
export interface Reminder {
  method: 'popup' | 'email'
  /** Minuter före start. */
  minutes: number
}

/**
 * Händelsens påminnelser. `useDefault` betyder kalenderns standardpåminnelser (`CalendarInfo.defaultReminders`),
 * annars gäller `overrides` (kan vara tom, och då finns inga påminnelser).
 */
export type EventReminders =
  { useDefault: true } | { useDefault: false; overrides: readonly Reminder[] }

export interface CalEvent {
  id: string
  calendarId: string
  /** Ändras av Google vid varje ändring. Används som cache-nyckel och för If-Match (senare faser). */
  etag: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  /** Saknas om Google inte skickat något, vilket betyder kalenderns standard. */
  reminders?: EventReminders
  /** Satt på instanser av en återkommande händelse (Google expanderar åt oss, singleEvents=true). */
  recurringEventId?: string
  /** Instans av en serie: den ursprungliga starttiden (samma form som start), även om instansen flyttats. */
  originalStart?: string
  /** Bara på huvudhändelsen för en serie: reglerna (RRULE, EXDATE, ...), som Google skickar dem. */
  recurrence?: readonly string[]
  /** Tidszonen som händelsens tider räknas i hos Google, om den angetts. Behövs för nya serier. */
  timeZone?: string
  /** Explicit familj från extendedProperties.private.scFamilyId. Används från Fas 2. */
  familyId?: string
  /** extendedProperties.private.scImportant === "1". */
  important: boolean
}
