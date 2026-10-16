import { useCallback, useEffect, useMemo, useRef } from 'react'

export interface DragCancel {
  /** Anropas när en dragning (flytta eller ändra längd) börjar, med musen som startade den. */
  begin: (event?: MouseEvent) => void
  /** Anropas när dragningen slutat, oavsett hur. */
  end: () => void
  /**
   * Anropas när dragningen gett en ändring. Svarar `true` om användaren tryckt Esc under dragningen, och
   * då ska ändringen kastas. Nollställer flaggan.
   */
  consumeCancel: () => boolean
}

/**
 * Esc avbryter en pågående dragning (PRD 6.4). FullCalendar saknar det, så vi gör det själva: Esc under
 * en dragning släpper musknappen åt användaren (ett syntetiskt `mouseup` vid senaste muspositionen, vilket får
 * FullCalendar att avsluta dragningen direkt) och märker dragningen som avbruten, så att ändringen som
 * FullCalendar då rapporterar kastas i stället för att sparas.
 */
export function useDragCancel(): DragCancel {
  const active = useRef(false)
  const cancelled = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const trackPointer = useCallback((event: MouseEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !active.current || cancelled.current) return
      // Esc ska bara avbryta dragningen, inte också stänga en popover eller liknande bakom.
      event.preventDefault()
      event.stopPropagation()
      cancelled.current = true
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: pointer.current.x,
          clientY: pointer.current.y,
        }),
      )
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousemove', trackPointer)
      clearTimeout(resetTimer.current)
    }
  }, [trackPointer])

  return useMemo<DragCancel>(
    () => ({
      begin: (event) => {
        clearTimeout(resetTimer.current)
        if (event instanceof MouseEvent) pointer.current = { x: event.clientX, y: event.clientY }
        active.current = true
        cancelled.current = false
        document.addEventListener('mousemove', trackPointer, { passive: true })
      },
      end: () => {
        active.current = false
        document.removeEventListener('mousemove', trackPointer)
        // FullCalendar rapporterar ändringen (om det blir någon) strax efter att dragningen slutat. Är det
        // ingen ändring, t.ex. för att släppet var utanför rutnätet, ska flaggan inte leva kvar till nästa.
        resetTimer.current = setTimeout(() => {
          cancelled.current = false
        }, 0)
      },
      consumeCancel: () => {
        const wasCancelled = cancelled.current
        cancelled.current = false
        return wasCancelled
      },
    }),
    [trackPointer],
  )
}
