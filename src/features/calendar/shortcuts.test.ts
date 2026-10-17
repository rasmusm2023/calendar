import { describe, expect, it } from 'vitest'
import { isOverlayOpen, isTextEntry, matchShortcut, type ShortcutKey } from './shortcuts'

function key(partial: ShortcutKey): ShortcutKey {
  return partial
}

describe('matchShortcut', () => {
  it('byter vy med D, W, N, M och A', () => {
    expect(matchShortcut(key({ key: 'd' }))).toEqual({ type: 'view', kind: 'day' })
    expect(matchShortcut(key({ key: 'W' }))).toEqual({ type: 'view', kind: 'week' })
    expect(matchShortcut(key({ key: 'n' }))).toEqual({ type: 'view', kind: 'days' })
    expect(matchShortcut(key({ key: 'm' }))).toEqual({ type: 'view', kind: 'month' })
    expect(matchShortcut(key({ key: 'a' }))).toEqual({ type: 'view', kind: 'agenda' })
  })

  it('bläddrar med J, K och piltangenter, och T går till idag', () => {
    expect(matchShortcut(key({ key: 'j' }))).toEqual({ type: 'navigate', direction: 1 })
    expect(matchShortcut(key({ key: 'K' }))).toEqual({ type: 'navigate', direction: -1 })
    expect(matchShortcut(key({ key: 'ArrowRight' }))).toEqual({ type: 'navigate', direction: 1 })
    expect(matchShortcut(key({ key: 'ArrowLeft' }))).toEqual({ type: 'navigate', direction: -1 })
    expect(matchShortcut(key({ key: 't' }))).toEqual({ type: 'today' })
  })

  it('skapar, redigerar, tar bort och visar hjälpen', () => {
    expect(matchShortcut(key({ key: 'c' }))).toEqual({ type: 'create' })
    expect(matchShortcut(key({ key: 'e' }))).toEqual({ type: 'edit' })
    expect(matchShortcut(key({ key: 'Delete' }))).toEqual({ type: 'delete' })
    expect(matchShortcut(key({ key: 'Backspace' }))).toEqual({ type: 'delete' })
    expect(matchShortcut(key({ key: '?' }))).toEqual({ type: 'help' })
  })

  it('ångrar med Ctrl/Cmd+Z och gör om med Ctrl/Cmd+Shift+Z eller Ctrl/Cmd+Y', () => {
    expect(matchShortcut(key({ key: 'z', ctrlKey: true }))).toEqual({ type: 'undo' })
    expect(matchShortcut(key({ key: 'z', metaKey: true }))).toEqual({ type: 'undo' })
    expect(matchShortcut(key({ key: 'z', ctrlKey: true, shiftKey: true }))).toEqual({
      type: 'redo',
    })
    expect(matchShortcut(key({ key: 'Z', metaKey: true, shiftKey: true }))).toEqual({
      type: 'redo',
    })
    expect(matchShortcut(key({ key: 'y', ctrlKey: true }))).toEqual({ type: 'redo' })
  })

  it('duplicerar med Ctrl/Cmd+D, men D utan modifierare byter till dag', () => {
    expect(matchShortcut(key({ key: 'd', ctrlKey: true }))).toEqual({ type: 'duplicate' })
    expect(matchShortcut(key({ key: 'd', metaKey: true }))).toEqual({ type: 'duplicate' })
    expect(matchShortcut(key({ key: 'd' }))).toEqual({ type: 'view', kind: 'day' })
  })

  it('tar inte webbläsarens kortkommandon eller upprepade kommandotangenter', () => {
    expect(matchShortcut(key({ key: 'c', ctrlKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'a', metaKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 't', ctrlKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'd', ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'z', ctrlKey: true, repeat: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'd', altKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'ArrowLeft', shiftKey: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'i' }))).toBeNull()
    expect(matchShortcut(key({ key: '/' }))).toBeNull()
  })

  it('låter en nedtryckt J bläddra vidare, men inte en nedtryckt C', () => {
    expect(matchShortcut(key({ key: 'j', repeat: true }))).toEqual({
      type: 'navigate',
      direction: 1,
    })
    expect(matchShortcut(key({ key: 'c', repeat: true }))).toBeNull()
    expect(matchShortcut(key({ key: 'Delete', repeat: true }))).toBeNull()
  })
})

describe('isTextEntry', () => {
  it('är sant i fält och falskt på knappar och händelser', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editable.append(child)
    const button = document.createElement('button')

    expect(isTextEntry(input)).toBe(true)
    expect(isTextEntry(area)).toBe(true)
    expect(isTextEntry(select)).toBe(true)
    expect(isTextEntry(child)).toBe(true)
    expect(isTextEntry(button)).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('isOverlayOpen', () => {
  it('ser öppen dialog och popover, men inte en stängd dialog', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.dataset.state = 'open'
    const popover = document.createElement('div')
    popover.dataset.slot = 'popover-content'
    popover.dataset.state = 'open'
    document.body.append(dialog, popover)
    try {
      expect(isOverlayOpen(document)).toBe(true)
      dialog.dataset.state = 'closed'
      expect(isOverlayOpen(document)).toBe(true)
      popover.remove()
      expect(isOverlayOpen(document)).toBe(false)
    } finally {
      dialog.remove()
      popover.remove()
    }
  })
})
