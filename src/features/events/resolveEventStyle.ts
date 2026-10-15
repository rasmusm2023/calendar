import { readableTextColor } from '@/lib/color'
import type { CalEvent } from '@/types'

export type EventDisplayStyle = 'filled' | 'tinted' | 'outline'

export interface EventStyle {
  bg: string
  border: string
  /** Svart eller vit, vald för WCAG AA-kontrast mot `bg`. */
  text: string
  style: EventDisplayStyle
  important: boolean
}

/**
 * Det som behövs för att räkna ut en händelses stil.
 * Fas 0: bara kalenderfärger. Familjer och regler (PROJECT.md §5.1) tillkommer i Fas 2.
 */
export interface StyleContext {
  /** calendarId -> bakgrundsfärg (hex) från Google calendarList. */
  calendarColors: ReadonlyMap<string, string>
}

/** Neutral färg för händelser vars kalender inte är känd (t.ex. tillfälligt saknad i listan). */
export const FALLBACK_EVENT_COLOR = '#6b7280'

/**
 * Räknar ut hur en händelse ska se ut. Färgen räknas ut vid visning och lagras aldrig per händelse
 * (PROJECT.md §5.1). Fas 0: kalenderns färg. Senare: familjens färg först.
 */
export function resolveEventStyle(event: CalEvent, ctx: StyleContext): EventStyle {
  const bg = ctx.calendarColors.get(event.calendarId) ?? FALLBACK_EVENT_COLOR
  return {
    bg,
    border: bg,
    text: readableTextColor(bg),
    style: 'filled',
    important: event.important,
  }
}
