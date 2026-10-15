/**
 * Appens egen händelsetyp. Resten av appen arbetar bara med den här typen, aldrig med
 * Googles råa format eller FullCalendars (PROJECT.md §2). Händelsedata lagras aldrig i Firestore.
 *
 * Tider är ISO-strängar med tidszon (PROJECT.md §7):
 * - tidsbestämd: RFC 3339 med offset, t.ex. "2026-10-19T09:00:00+02:00"
 * - heldag: rent datum "2026-10-19". `end` är exklusivt, som hos Google (en heldag på en dag har
 *   end = nästa dag).
 */
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
  /** Satt på instanser av en återkommande händelse (Google expanderar åt oss, singleEvents=true). */
  recurringEventId?: string
  /** Explicit familj från extendedProperties.private.scFamilyId. Används från Fas 2. */
  familyId?: string
  /** extendedProperties.private.scImportant === "1". */
  important: boolean
}
