import { useEffect, useRef } from 'react'
import { eventRefFromTarget, type GridEventRef } from './eventTarget'
import { isOverlayOpen, isTextEntry, matchShortcut, type Shortcut } from './shortcuts'
import type { CalendarViewKind } from './calendarView'

export interface ShortcutHandlers {
  /** Den valda händelsen, den som kortkommandon gäller när fokus ligger någon annanstans. */
  selected: GridEventRef | null
  onSelect: (ref: GridEventRef) => void
  onView: (kind: CalendarViewKind) => void
  onToday: () => void
  onNavigate: (direction: -1 | 1) => void
  onCreate: () => void
  onEdit: (ref: GridEventRef) => void
  onDelete: (ref: GridEventRef) => void
  onDuplicate: (ref: GridEventRef) => void
  onUndo: () => void
  onRedo: () => void
  onHelp: () => void
}

/**
 * Lyssnar på kortkommandon för kalendern. Gäller inte medan man skriver i ett fält eller en dialog
 * eller popover är öppen. Händelsekommandon (redigera, ta bort, duplicera) gäller den händelse som
 * har fokus, och annars den valda händelsen, så att de inte kräver att fokus ligger kvar på den.
 */
export function useCalendarShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const ref = eventRefFromTarget(event.target)
      if (ref !== null) handlersRef.current.onSelect(ref)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (isTextEntry(event.target) || isOverlayOpen(document)) return
      const shortcut = matchShortcut(event)
      if (shortcut === null) return
      if (!runShortcut(shortcut, event, handlersRef.current)) return
      event.preventDefault()
    }

    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

/** Kör kommandot. Returnerar false om det inte fanns någon händelse att gälla. */
function runShortcut(
  shortcut: Shortcut,
  event: KeyboardEvent,
  handlers: ShortcutHandlers,
): boolean {
  const focused = eventRefFromTarget(event.target)
  if (focused !== null) handlers.onSelect(focused)
  const target = focused ?? handlers.selected

  switch (shortcut.type) {
    case 'view':
      handlers.onView(shortcut.kind)
      return true
    case 'today':
      handlers.onToday()
      return true
    case 'navigate':
      handlers.onNavigate(shortcut.direction)
      return true
    case 'create':
      handlers.onCreate()
      return true
    case 'help':
      handlers.onHelp()
      return true
    case 'undo':
      handlers.onUndo()
      return true
    case 'redo':
      handlers.onRedo()
      return true
    case 'edit':
      if (target === null) return false
      handlers.onEdit(target)
      return true
    case 'delete':
      if (target === null) return false
      handlers.onDelete(target)
      return true
    case 'duplicate':
      if (target === null) return false
      handlers.onDuplicate(target)
      return true
  }
}
