import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth'
import type { CalendarInfo } from '@/types'
import {
  clearSelection,
  loadSelection,
  resolveVisibleCalendars,
  saveSelection,
  type SelectionStorage,
} from './calendarSelection'

export interface CalendarSelection {
  /** Kalendrarna som visas, i kalenderlistans ordning. */
  visible: CalendarInfo[]
  isVisible: (calendarId: string) => boolean
  toggle: (calendarId: string) => void
  /** Sant om användaren har gjort ett eget val (annars gäller Googles). */
  isCustom: boolean
  /** Gå tillbaka till Googles val. */
  reset: () => void
}

function browserStorage(): SelectionStorage | null {
  try {
    return window.localStorage
  } catch {
    // Åtkomst till localStorage kan kasta, t.ex. när cookies är blockerade.
    return null
  }
}

/**
 * Valet av kalendrar för inloggad användare. Sparas lokalt per användare (inte i Firestore) och gäller
 * tills Fas 2 ersätter det med spaces (PRD 6.1). Utan eget val gäller Googles `selected`.
 */
export function useCalendarSelection(
  calendars: readonly CalendarInfo[],
  storage: SelectionStorage | null = browserStorage(),
): CalendarSelection {
  const { state } = useAuth()
  const uid = state.status === 'signedIn' ? state.user.uid : null

  // Valet hör till en användare. Byter användare läses det nya användarens val in.
  const [own, setOwn] = useState<{ uid: string | null; ids: string[] | null }>(() => ({
    uid,
    ids: uid === null ? null : loadSelection(storage, uid),
  }))
  const saved = own.uid === uid ? own.ids : uid === null ? null : loadSelection(storage, uid)

  const visible = useMemo(() => resolveVisibleCalendars(calendars, saved), [calendars, saved])

  const update = useCallback(
    (ids: string[] | null) => {
      if (uid !== null) {
        if (ids === null) clearSelection(storage, uid)
        else saveSelection(storage, uid, ids)
      }
      setOwn({ uid, ids })
    },
    [uid, storage],
  )

  const toggle = useCallback(
    (calendarId: string) => {
      const current = visible.map((calendar) => calendar.id)
      update(
        current.includes(calendarId)
          ? current.filter((id) => id !== calendarId)
          : [...current, calendarId],
      )
    },
    [visible, update],
  )

  const reset = useCallback(() => {
    update(null)
  }, [update])

  const isVisible = useCallback(
    (calendarId: string) => visible.some((calendar) => calendar.id === calendarId),
    [visible],
  )

  return { visible, isVisible, toggle, isCustom: saved !== null, reset }
}
