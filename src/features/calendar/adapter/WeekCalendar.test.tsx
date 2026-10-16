import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StyleContext } from '@/features/events'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import type { CalEvent } from '@/types'
import { WeekCalendar } from './WeekCalendar'

const STYLE: StyleContext = { calendarColors: new Map([['work', TEST_CALENDAR_COLOR]]) }

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

function renderWeek(events: CalEvent[], date = new Date('2026-10-21T12:00:00Z'), locale = 'sv') {
  return render(
    <WeekCalendar
      events={events}
      styleContext={STYLE}
      date={date}
      locale={locale}
      ariaLabel="Veckokalender"
    />,
  )
}

describe('WeekCalendar', () => {
  it('visar kalenderområdet med ett tillgängligt namn', () => {
    renderWeek([])

    expect(screen.getByRole('region', { name: 'Veckokalender' })).toBeInTheDocument()
  })

  it('visar tidsbestämda händelser och heldagshändelser', () => {
    renderWeek([event('a'), event('b', { allDay: true, start: '2026-10-21', end: '2026-10-22' })])

    expect(screen.getByText('Händelse a')).toBeInTheDocument()
    expect(screen.getByText('Händelse b')).toBeInTheDocument()
  })

  it('visar sju dagar med måndag först', () => {
    const { container } = renderWeek([])

    const headers = container.querySelectorAll('.fc-col-header-cell')
    expect(headers).toHaveLength(7)
    expect(headers[0]?.getAttribute('data-date')).toBe('2026-10-19')
    expect(headers[6]?.getAttribute('data-date')).toBe('2026-10-25')
  })

  it('byter vecka när datumet ändras och behåller händelserna', () => {
    const events = [event('a')]
    const { container, rerender } = renderWeek(events)

    rerender(
      <WeekCalendar
        events={events}
        styleContext={STYLE}
        date={new Date('2026-10-28T12:00:00Z')}
        locale="sv"
        ariaLabel="Veckokalender"
      />,
    )

    const first = container.querySelector('.fc-col-header-cell')
    expect(first?.getAttribute('data-date')).toBe('2026-10-26')
  })

  it('sätter händelsens färg från kalendern', () => {
    renderWeek([event('a')])

    const block = screen.getByText('Händelse a').closest('.fc-event')
    expect(block).toHaveStyle({ backgroundColor: TEST_CALENDAR_COLOR })
  })

  it('går att visa på engelska', () => {
    renderWeek([event('a')], new Date('2026-10-21T12:00:00Z'), 'en')

    expect(screen.getByText('Händelse a')).toBeInTheDocument()
  })
})
