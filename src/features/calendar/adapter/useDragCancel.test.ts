import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDragCancel } from './useDragCancel'

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  return event
}

describe('useDragCancel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('släpper musen vid senaste muspositionen och märker dragningen som avbruten när Esc trycks under en dragning', () => {
    const { result } = renderHook(() => useDragCancel())
    const mouseups: MouseEvent[] = []
    const onMouseUp = (event: Event) => {
      mouseups.push(event as MouseEvent)
    }
    document.addEventListener('mouseup', onMouseUp)

    result.current.begin(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 260 }))
    const event = pressEscape()
    document.removeEventListener('mouseup', onMouseUp)

    expect(mouseups).toHaveLength(1)
    expect(mouseups[0]).toMatchObject({ clientX: 150, clientY: 260 })
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.consumeCancel()).toBe(true)
    expect(result.current.consumeCancel()).toBe(false)
  })

  it('gör ingenting när Esc trycks utan dragning', () => {
    const { result } = renderHook(() => useDragCancel())
    const onMouseUp = vi.fn()
    document.addEventListener('mouseup', onMouseUp)

    const event = pressEscape()
    document.removeEventListener('mouseup', onMouseUp)

    expect(onMouseUp).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(result.current.consumeCancel()).toBe(false)
  })

  it('släpper inte musen mer än en gång även om Esc trycks flera gånger', () => {
    const { result } = renderHook(() => useDragCancel())
    const onMouseUp = vi.fn()
    document.addEventListener('mouseup', onMouseUp)

    result.current.begin()
    pressEscape()
    pressEscape()
    document.removeEventListener('mouseup', onMouseUp)

    expect(onMouseUp).toHaveBeenCalledTimes(1)
  })

  it('glömmer en avbruten dragning som inte gav någon ändring, så att nästa dragning sparas', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDragCancel())

    result.current.begin()
    pressEscape()
    result.current.end()
    vi.runAllTimers()
    result.current.begin()

    expect(result.current.consumeCancel()).toBe(false)
  })

  it('en avbruten dragning kan fortfarande läsas av ändringen som kommer efter att dragningen slutat', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDragCancel())

    result.current.begin()
    pressEscape()
    result.current.end()

    expect(result.current.consumeCancel()).toBe(true)
  })

  it('lyssnar inte längre efter att komponenten tagits bort', () => {
    const { result, unmount } = renderHook(() => useDragCancel())
    const onMouseUp = vi.fn()
    document.addEventListener('mouseup', onMouseUp)
    result.current.begin()
    unmount()

    pressEscape()
    document.removeEventListener('mouseup', onMouseUp)

    expect(onMouseUp).not.toHaveBeenCalled()
  })
})
