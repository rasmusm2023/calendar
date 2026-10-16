import { z } from 'zod'
import type { CalendarInfo } from '@/types'

const selectionSchema = z.array(z.string())

/** Minsta delen av `Storage` som vi använder. Gör det enkelt att byta ut i tester. */
export type SelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storageKey(uid: string): string {
  return `sc:calendarSelection:${uid}`
}

/**
 * Användarens sparade kalendervalg (kalender-id:n) eller `null` om hen inte har valt något själv.
 * Trasig eller ogiltig data, och en webbläsare som saknar lagring, behandlas som "inget val".
 */
export function loadSelection(storage: SelectionStorage | null, uid: string): string[] | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(storageKey(uid))
    if (raw === null) return null
    const parsed = selectionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Sparar valet lokalt per användare. Misslyckas lagringen (privat läge, full kvot) går appen vidare utan. */
export function saveSelection(
  storage: SelectionStorage | null,
  uid: string,
  calendarIds: readonly string[],
): void {
  try {
    storage?.setItem(storageKey(uid), JSON.stringify(calendarIds))
  } catch {
    // Valet gäller då bara tills sidan laddas om.
  }
}

/** Tar bort det sparade valet, så att Googles val gäller igen. */
export function clearSelection(storage: SelectionStorage | null, uid: string): void {
  try {
    storage?.removeItem(storageKey(uid))
  } catch {
    // Se saveSelection.
  }
}

/**
 * Standardval: kalendrarna som är "tända" i Google Calendar. Har användaren släckt alla visas alla,
 * så att vyn aldrig blir tom av misstag.
 */
export function defaultVisibleIds(calendars: readonly CalendarInfo[]): string[] {
  const selected = calendars.filter((calendar) => calendar.selected)
  return (selected.length > 0 ? selected : calendars).map((calendar) => calendar.id)
}

/**
 * Vilka kalendrar som visas. Ett eget val gäller exakt som sparat: kalendrar som inte längre finns hoppas
 * över, och nya kalendrar visas inte förrän användaren väljer dem. Ett tomt val är giltigt.
 */
export function resolveVisibleCalendars(
  calendars: readonly CalendarInfo[],
  saved: readonly string[] | null,
): CalendarInfo[] {
  const ids = new Set(saved ?? defaultVisibleIds(calendars))
  return calendars.filter((calendar) => ids.has(calendar.id))
}
