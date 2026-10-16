import { useCallback, useState } from 'react'
import { useAuth } from '@/features/auth'
import {
  DEFAULT_VIEW,
  clampDays,
  loadView,
  saveView,
  type CalendarView,
  type CalendarViewKind,
  type ViewStorage,
} from './calendarView'

export interface CalendarViewState {
  view: CalendarView
  setKind: (kind: CalendarViewKind) => void
  setDays: (days: number) => void
}

function browserStorage(): ViewStorage | null {
  try {
    return window.localStorage
  } catch {
    // Åtkomst till localStorage kan kasta, t.ex. när cookies är blockerade.
    return null
  }
}

/**
 * Vilken vy som visas. Sparas lokalt per användare så att vyn finns kvar efter omladdning. I Fas 2 minns
 * varje space sin egen vy (PRD 6.5), och då ersätts det här.
 */
export function useCalendarView(storage: ViewStorage | null = browserStorage()): CalendarViewState {
  const { state } = useAuth()
  const uid = state.status === 'signedIn' ? state.user.uid : null

  // Valet hör till en användare. Byter användare läses den nya användarens vy in.
  const [own, setOwn] = useState<{ uid: string | null; view: CalendarView }>(() => ({
    uid,
    view: uid === null ? DEFAULT_VIEW : loadView(storage, uid),
  }))
  const view = own.uid === uid ? own.view : uid === null ? DEFAULT_VIEW : loadView(storage, uid)

  const update = useCallback(
    (next: CalendarView) => {
      if (uid !== null) saveView(storage, uid, next)
      setOwn({ uid, view: next })
    },
    [uid, storage],
  )

  const setKind = useCallback(
    (kind: CalendarViewKind) => {
      update({ ...view, kind })
    },
    [update, view],
  )

  const setDays = useCallback(
    (days: number) => {
      update({ kind: 'days', days: clampDays(days) })
    },
    [update],
  )

  return { view, setKind, setDays }
}
