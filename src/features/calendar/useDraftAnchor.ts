import { useCallback, useMemo, useRef, type RefObject } from 'react'
import type { PopoverAnchorTarget } from '@/features/events'

/**
 * Plats för en popover som ska peka på utkastet i rutnätet. Rutnätet ritar om utkastet när något ändras, och
 * då byts elementet ut: under bytet gäller senast kända plats, så popovern inte hoppar. Finns inget
 * element (utkastet syns inte i perioden som visas) pekar popovern på `fallback`.
 */
export function useDraftAnchor(fallback: RefObject<HTMLElement | null>) {
  const element = useRef<HTMLElement | null>(null)
  const lastRect = useRef<DOMRect | null>(null)

  const anchor = useMemo<RefObject<PopoverAnchorTarget | null>>(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const target = element.current
          if (target?.isConnected) {
            lastRect.current = target.getBoundingClientRect()
            return lastRect.current
          }
          return lastRect.current ?? fallback.current?.getBoundingClientRect() ?? new DOMRect()
        },
      },
    }),
    [fallback],
  )

  /** Ett utkast ritades. */
  const setElement = useCallback((next: HTMLElement) => {
    element.current = next
  }, [])

  /** Ett nytt utkast börjar: glöm den gamla platsen. */
  const reset = useCallback(() => {
    element.current = null
    lastRect.current = null
  }, [])

  return { anchor, setElement, reset }
}
