import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '@/i18n'
import { GoogleApiError, type QueryParams } from '@/lib/google'
import { setupFakeGoogleClient, type Responder } from '@/test/fakeGoogleClient'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import { WeekPage } from './WeekPage'

// Onsdag 21 okt 2026 (vecka 43, 19-25 okt).
const NOW = new Date('2026-10-21T12:00:00Z')

function calendarEntry(id: string, extra: Record<string, unknown> = {}) {
  return { id, summary: id, backgroundColor: TEST_CALENDAR_COLOR, accessRole: 'owner', ...extra }
}

function eventItem(id: string, start = '2026-10-21T10:00:00Z', end = '2026-10-21T11:00:00Z') {
  return {
    id,
    etag: `"${id}"`,
    summary: `Händelse ${id}`,
    start: { dateTime: start },
    end: { dateTime: end },
  }
}

function calendarIdOf(path: string) {
  return decodeURIComponent(path.split('/')[2] ?? '')
}

interface Options {
  calendars?: Record<string, unknown>[]
  events?: (calendarId: string, params: QueryParams) => unknown
  responder?: Responder
}

async function renderPage({
  calendars = [calendarEntry('a', { selected: true })],
  events = (calendarId) => ({ items: [eventItem(`from-${calendarId}`)] }),
  responder,
}: Options = {}) {
  const fake = setupFakeGoogleClient(
    responder ??
      ((path, params) =>
        path === '/users/me/calendarList'
          ? { items: calendars }
          : events(calendarIdOf(path), params)),
  )
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <fake.Wrapper>
        <WeekPage />
      </fake.Wrapper>
    </I18nextProvider>,
  )
  return { ...fake, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

function eventCalls(getJson: ReturnType<typeof setupFakeGoogleClient>['getJson']) {
  return getJson.mock.calls.filter(([path]) => path !== '/users/me/calendarList')
}

describe('WeekPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('visar laddning och därefter händelser och veckans titel', async () => {
    await renderPage()

    expect(screen.getByTestId('calendar-loading')).toBeInTheDocument()
    expect(await screen.findByText('Händelse from-a')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('week-title')).toHaveTextContent('v43')
    expect(screen.getByRole('region', { name: 'Veckokalender' })).toBeInTheDocument()
  })

  it('hämtar bara kalendrar som är tända i Google', async () => {
    const { getJson } = await renderPage({
      calendars: [
        calendarEntry('on', { selected: true }),
        calendarEntry('off', { selected: false }),
      ],
    })

    expect(await screen.findByText('Händelse from-on')).toBeInTheDocument()
    expect(screen.queryByText('Händelse from-off')).not.toBeInTheDocument()
    expect(eventCalls(getJson).map(([path]) => calendarIdOf(path))).toEqual(['on'])
  })

  it('visar alla kalendrar om användaren har släckt alla', async () => {
    await renderPage({
      calendars: [calendarEntry('x', { selected: false }), calendarEntry('y', { selected: false })],
    })

    expect(await screen.findByText('Händelse from-x')).toBeInTheDocument()
    expect(await screen.findByText('Händelse from-y')).toBeInTheDocument()
  })

  it('hämtar måndag till måndag för aktuell vecka', async () => {
    const { getJson } = await renderPage()
    await screen.findByText('Händelse from-a')

    const params = eventCalls(getJson)[0]?.[1]
    expect(params?.timeMin).toMatch(/^2026-10-19T00:00:00/)
    expect(params?.timeMax).toMatch(/^2026-10-26T00:00:00/)
  })

  it('bläddrar till nästa och föregående vecka och tillbaka med Idag', async () => {
    const { getJson, user } = await renderPage()
    await screen.findByText('Händelse from-a')
    const title = screen.getByTestId('week-title')
    const thisWeek = title.textContent

    await user.click(screen.getByRole('button', { name: 'Nästa vecka' }))
    await waitFor(() => {
      expect(title).toHaveTextContent('v44')
    })
    expect(eventCalls(getJson).at(-1)?.[1]?.timeMin).toMatch(/^2026-10-26T00:00:00/)

    await user.click(screen.getByRole('button', { name: 'Föregående vecka' }))
    await user.click(screen.getByRole('button', { name: 'Föregående vecka' }))
    await waitFor(() => {
      expect(title).toHaveTextContent('v42')
    })

    await user.click(screen.getByRole('button', { name: 'Idag' }))
    await waitFor(() => {
      expect(title.textContent).toBe(thisWeek)
    })
  })

  it('har en namngiven verktygsrad', async () => {
    await renderPage()
    await screen.findByText('Händelse from-a')

    const toolbar = screen.getByRole('toolbar', { name: 'Veckonavigering' })
    expect(within(toolbar).getAllByRole('button')).toHaveLength(3)
  })

  it('visar felmeddelande med "Försök igen" när kalenderlistan inte går att hämta', async () => {
    let failing = true
    const { user } = await renderPage({
      responder: (path) => {
        if (path === '/users/me/calendarList') {
          if (failing) throw new GoogleApiError('network', 0)
          return { items: [calendarEntry('a', { selected: true })] }
        }
        return { items: [eventItem('from-a')] }
      },
    })

    const alert = await screen.findByTestId('calendar-load-error')
    expect(alert).toHaveTextContent('Det gick inte att hämta dina kalendrar')
    expect(alert).toHaveTextContent('Kontrollera din internetanslutning')

    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Försök igen' }))

    expect(await screen.findByText('Händelse from-a')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-load-error')).not.toBeInTheDocument()
  })

  it('visar de kalendrar som gick bra och varnar för de som inte gjorde det', async () => {
    await renderPage({
      calendars: [
        calendarEntry('ok', { selected: true }),
        calendarEntry('bad', { selected: true }),
      ],
      events: (calendarId) => {
        if (calendarId === 'bad') throw new GoogleApiError('forbidden', 403)
        return { items: [eventItem('from-ok')] }
      },
    })

    expect(await screen.findByText('Händelse from-ok')).toBeInTheDocument()
    const warning = await screen.findByTestId('calendar-events-error')
    expect(warning).toHaveTextContent('1 av 2 kalendrar visas inte')
  })

  it('meddelar när användaren inte har några kalendrar', async () => {
    await renderPage({ calendars: [] })

    expect(await screen.findByTestId('calendar-empty')).toHaveTextContent('inga kalendrar')
  })
})
