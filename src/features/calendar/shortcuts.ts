import type { CalendarViewKind } from './calendarView'

/**
 * Kortkommandon för fas 1 (PRD 6.9, det som redan finns). Spaces (Ctrl+1…9), Viktig (I) och sök (/)
 * hör till senare faser och finns inte här.
 *
 * N väljer vyn "N dagar", som inte har en bokstav i PRD-listan men redan finns som vy.
 */
export type Shortcut =
  | { type: 'view'; kind: CalendarViewKind }
  | { type: 'today' }
  | { type: 'navigate'; direction: -1 | 1 }
  | { type: 'create' }
  | { type: 'edit' }
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'help' }

export interface ShortcutKey {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
}

const VIEW_KEYS: Readonly<Record<string, CalendarViewKind>> = {
  d: 'day',
  w: 'week',
  n: 'days',
  m: 'month',
  a: 'agenda',
}

/** Sant när tangenten skrevs i ett fält. Då ska webbläsaren hantera den (text, ångra i fältet). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** Sant när en dialog eller popover är öppen. Kortkommandon ska inte gå igenom den. */
export function isOverlayOpen(doc: Document): boolean {
  return (
    doc.querySelector('[role="dialog"][data-state="open"]') !== null ||
    doc.querySelector('[data-slot="popover-content"][data-state="open"]') !== null
  )
}

/** Vilket kortkommando tangenten är, eller `null` om den inte är ett av våra. */
export function matchShortcut(event: ShortcutKey): Shortcut | null {
  if (event.altKey === true) return null
  const command = event.ctrlKey === true || event.metaKey === true
  const key = event.key

  if (command) {
    if (event.repeat === true) return null
    const lower = key.toLowerCase()
    if (lower === 'z' && event.shiftKey !== true) return { type: 'undo' }
    if (lower === 'z' && event.shiftKey === true) return { type: 'redo' }
    if (lower === 'y' && event.shiftKey !== true) return { type: 'redo' }
    if (lower === 'd' && event.shiftKey !== true) return { type: 'duplicate' }
    return null
  }

  if (event.shiftKey !== true) {
    if (key === 'ArrowRight' || key === 'j' || key === 'J') {
      return { type: 'navigate', direction: 1 }
    }
    if (key === 'ArrowLeft' || key === 'k' || key === 'K') {
      return { type: 'navigate', direction: -1 }
    }
  }

  if (event.repeat === true) return null
  if (key === '?') return { type: 'help' }
  if (event.shiftKey === true) return null
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' }

  const lower = key.toLowerCase()
  if (lower === 't') return { type: 'today' }
  if (lower === 'c') return { type: 'create' }
  if (lower === 'e') return { type: 'edit' }
  const view = VIEW_KEYS[lower]
  if (view !== undefined) return { type: 'view', kind: view }
  return null
}
