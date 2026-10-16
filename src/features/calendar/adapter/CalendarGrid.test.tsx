import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StyleContext } from '@/features/events'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import type { CalEvent } from '@/types'
import { DEFAULT_VIEW, type CalendarView } from '../calendarView'
import { CalendarGrid } from './CalendarGrid'

const STYLE: StyleContext = { calendarColors: new Map([['work', TEST_CALENDAR_COLOR]]) }
// Onsdag 21 okt 2026 (vecka 43).
const WEDNESDAY = new Date('2026-10-21T12:00:00Z')

const WEEK: CalendarView = DEFAULT_VIEW
const view = (kind: CalendarView['kind'], days = 3): CalendarView => ({ kind, days })

function event(id: string, extra: Partial<CalEvent> = {}): CalEvent {
  return {
    id,
    calendarId: 'work',
    etag: `"${id}"`,
    title: `Händelse ${id}`,
    start: '2026-10-21T12:00:00Z',
    end: '2026-10-21T13:00:00Z',
    allDay: false,
    important: false,
    ...extra,
  }
}

interface Options {
  events?: CalEvent[]
  date?: Date
  view?: CalendarView
  locale?: string
  monthFilledBlocks?: boolean
}

function ui({
  events = [],
  date = WEDNESDAY,
  view: calendarView = WEEK,
  locale = 'sv',
  monthFilledBlocks,
}: Options = {}) {
  return (
    <CalendarGrid
      events={events}
      styleContext={STYLE}
      view={calendarView}
      date={date}
      locale={locale}
      ariaLabel="Kalender"
      {...(monthFilledBlocks !== undefined && { monthFilledBlocks })}
    />
  )
}

function renderGrid(options: Options = {}) {
  return render(ui(options))
}

/** Datumen (data-date) för kolumnrubrikerna i tidsrutnätet. */
function columnDates(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.fc-col-header-cell')).map((cell) =>
    cell.getAttribute('data-date'),
  )
}

describe('CalendarGrid', () => {
  it('visar kalenderområdet med ett tillgängligt namn', () => {
    renderGrid()

    expect(screen.getByRole('region', { name: 'Kalender' })).toBeInTheDocument()
  })

  it('visar tidsbestämda händelser och heldagshändelser', () => {
    renderGrid({
      events: [event('a'), event('b', { allDay: true, start: '2026-10-21', end: '2026-10-22' })],
    })

    expect(screen.getByText('Händelse a')).toBeInTheDocument()
    expect(screen.getByText('Händelse b')).toBeInTheDocument()
  })

  it('sätter händelsens färg från kalendern', () => {
    renderGrid({ events: [event('a')] })

    const block = screen.getByText('Händelse a').closest('.fc-event')
    expect(block).toHaveStyle({ backgroundColor: TEST_CALENDAR_COLOR })
  })

  it('går att visa på engelska', () => {
    renderGrid({ events: [event('a')], locale: 'en' })

    expect(screen.getByText('Händelse a')).toBeInTheDocument()
  })

  describe('vecka', () => {
    it('visar sju dagar med måndag först', () => {
      const { container } = renderGrid()

      const dates = columnDates(container)
      expect(dates).toHaveLength(7)
      expect(dates[0]).toBe('2026-10-19')
      expect(dates[6]).toBe('2026-10-25')
    })

    it('byter vecka när datumet ändras och behåller händelserna', () => {
      const events = [event('a')]
      const { container, rerender } = renderGrid({ events })

      rerender(ui({ events, date: new Date('2026-10-28T12:00:00Z') }))

      expect(columnDates(container)[0]).toBe('2026-10-26')
    })
  })

  describe('dag', () => {
    it('visar bara den dag som datumet tillhör', () => {
      const { container } = renderGrid({ view: view('day') })

      expect(columnDates(container)).toEqual(['2026-10-21'])
    })

    it('visar händelser den dagen', () => {
      renderGrid({ view: view('day'), events: [event('a')] })

      expect(screen.getByText('Händelse a')).toBeInTheDocument()
    })
  })

  describe('N dagar', () => {
    it.each([2, 3, 5, 14])('visar %i dagar från datumet', (days) => {
      const { container } = renderGrid({ view: view('days', days) })

      const dates = columnDates(container)
      expect(dates).toHaveLength(days)
      expect(dates[0]).toBe('2026-10-21')
    })

    it('byter antal dagar när vyn ändras', () => {
      const { container, rerender } = renderGrid({ view: view('days', 3) })
      expect(columnDates(container)).toHaveLength(3)

      rerender(ui({ view: view('days', 5) }))

      expect(columnDates(container)).toEqual([
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
        '2026-10-25',
      ])
    })
  })

  describe('månad', () => {
    it('visar hela veckor, måndag först, utan fast antal veckor', () => {
      const { container } = renderGrid({ view: view('month') })

      // Oktober 2026 börjar på en torsdag och slutar på en lördag: 28 sep till 1 nov, fem veckor.
      const cells = container.querySelectorAll('.fc-daygrid-day')
      expect(cells).toHaveLength(35)
      expect(cells[0]?.getAttribute('data-date')).toBe('2026-09-28')
      expect(cells[34]?.getAttribute('data-date')).toBe('2026-11-01')
    })

    it('visar tidsbestämda händelser som fyllda block som standard', () => {
      const { container } = renderGrid({ view: view('month'), events: [event('a')] })

      expect(container.querySelector('.fc-daygrid-block-event')).not.toBeNull()
      expect(container.querySelector('.fc-daygrid-dot-event')).toBeNull()
    })

    it('kan visa tidsbestämda händelser som prickar', () => {
      const { container } = renderGrid({
        view: view('month'),
        events: [event('a')],
        monthFilledBlocks: false,
      })

      expect(container.querySelector('.fc-daygrid-dot-event')).not.toBeNull()
    })

    it('visar veckonummer', () => {
      const { container } = renderGrid({ view: view('month') })

      expect(container.querySelectorAll('.fc-daygrid-week-number')).toHaveLength(5)
    })
  })

  describe('schema', () => {
    it('listar händelser med dag och tid', () => {
      const { container } = renderGrid({
        view: view('agenda'),
        events: [
          event('a'),
          event('b', { start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' }),
        ],
      })

      expect(container.querySelector('.fc-list')).not.toBeNull()
      expect(screen.getByText('Händelse a')).toBeInTheDocument()
      expect(screen.getByText('Händelse b')).toBeInTheDocument()
    })

    it('visar 30 dygn från datumet, inte längre', () => {
      renderGrid({
        view: view('agenda'),
        events: [
          event('inne', { start: '2026-11-19T09:00:00Z', end: '2026-11-19T10:00:00Z' }),
          event('ute', { start: '2026-11-20T09:00:00Z', end: '2026-11-20T10:00:00Z' }),
        ],
      })

      expect(screen.getByText('Händelse inne')).toBeInTheDocument()
      expect(screen.queryByText('Händelse ute')).not.toBeInTheDocument()
    })
  })

  describe('byte av vy', () => {
    it('byter från vecka till månad och tillbaka utan att tappa händelserna', () => {
      const events = [event('a')]
      const { container, rerender } = renderGrid({ events })
      expect(columnDates(container)).toHaveLength(7)

      rerender(ui({ events, view: view('month') }))
      expect(container.querySelectorAll('.fc-daygrid-day')).toHaveLength(35)
      expect(screen.getByText('Händelse a')).toBeInTheDocument()

      rerender(ui({ events, view: view('day') }))
      expect(columnDates(container)).toEqual(['2026-10-21'])
      expect(screen.getByText('Händelse a')).toBeInTheDocument()
    })
  })
})
