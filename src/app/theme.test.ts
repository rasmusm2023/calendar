import { describe, expect, it } from 'vitest'
import { applySystemTheme } from './theme'

type Listener = (event: MediaQueryListEvent) => void

function createMatchMedia(initialDark: boolean) {
  let matches = initialDark
  const listeners = new Set<Listener>()
  const query = {
    get matches() {
      return matches
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  } as unknown as MediaQueryList
  return {
    matchMedia: () => query,
    setDark(next: boolean) {
      matches = next
      listeners.forEach((listener) => {
        listener({ matches: next } as MediaQueryListEvent)
      })
    },
    listenerCount: () => listeners.size,
  }
}

describe('applySystemTheme', () => {
  it('sätter dark-klassen när systemet är mörkt', () => {
    const root = document.createElement('html')
    const media = createMatchMedia(true)
    applySystemTheme(root, media.matchMedia)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
  })

  it('följer systemets växling och avregistrerar lyssnaren', () => {
    const root = document.createElement('html')
    const media = createMatchMedia(false)
    const stop = applySystemTheme(root, media.matchMedia)
    expect(root.classList.contains('dark')).toBe(false)

    media.setDark(true)
    expect(root.classList.contains('dark')).toBe(true)

    media.setDark(false)
    expect(root.classList.contains('dark')).toBe(false)

    stop()
    expect(media.listenerCount()).toBe(0)
  })
})
