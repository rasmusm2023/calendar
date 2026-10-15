export type CalendarAccessRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner'

/**
 * En Google-kalender som appen känner till (från calendarList). Hämtas alltid från Google och
 * sparas inte i Firestore. Appens egna inställningar per kalender (calendarPrefs) kommer i Fas 2.
 */
export interface CalendarInfo {
  id: string
  name: string
  /** Kalenderns färg som hex (#rrggbb), hämtad med colorRgbFormat=true. */
  backgroundColor: string
  /** Kalenderns visningsval i Google (om den är "tänd" i Google Calendar). */
  selected: boolean
  primary: boolean
  accessRole: CalendarAccessRole
  timeZone?: string
}
