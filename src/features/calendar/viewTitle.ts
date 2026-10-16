import { getISOWeek } from 'date-fns'
import type { DateRange } from '@/lib/dates'
import type { CalendarView } from './calendarView'
import { formatWeekSpan } from './weekTitle'

interface TitleParams {
  view: CalendarView
  range: DateRange
  /** Ankardatumet. Månadsvyn har ett intervall som sträcker sig in i grannmånaderna, så titeln hämtas härifrån. */
  anchor: Date
  timeZone: string
  locale: string
}

/**
 * Rubriken i verktygsraden: "onsdag 21 oktober 2026" (dag), "19–25 okt. 2026" (vecka, N dagar och schema)
 * eller "oktober 2026" (månad).
 */
export function formatViewTitle({ view, range, anchor, timeZone, locale }: TitleParams): string {
  switch (view.kind) {
    case 'day':
      return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone,
      }).format(range.start)
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone }).format(
        anchor,
      )
    case 'week':
    case 'days':
    case 'agenda':
      return formatWeekSpan(range, timeZone, locale)
  }
}

/** ISO-veckonummer som visas bredvid rubriken, eller `null` när vyn inte hör till en enskild vecka. */
export function viewWeekNumber(view: CalendarView, range: DateRange): number | null {
  return view.kind === 'week' || view.kind === 'day' ? getISOWeek(range.start) : null
}
