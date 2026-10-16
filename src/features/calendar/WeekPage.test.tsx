import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth'
import { createI18n } from '@/i18n'
import { GoogleAccessError, GoogleApiError, type QueryParams } from '@/lib/google'
import { createFakeAuthService, TEST_USER, type InitialAuth } from '@/test/fakeAuthService'
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
  auth?: InitialAuth
}

async function renderPage({
  calendars = [calendarEntry('a', { selected: true })],
  events = (calendarId) => ({ items: [eventItem(`from-${calendarId}`)] }),
  responder,
  auth = TEST_USER,
}: Options = {}) {
  const fake = setupFakeGoogleClient(
    responder ??
      ((path, params) =>
        path === '/users/me/calendarList'
          ? { items: calendars }
          : events(calendarIdOf(path), params)),
  )
  const i18n = await createI18n('sv')
  const authService = createFakeAuthService(auth)
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={authService.service}>
        <fake.Wrapper>
          <WeekPage />
        </fake.Wrapper>
      </AuthProvider>
    </I18nextProvider>,
  )
  return { ...fake, unmount, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

function eventCalls(getJson: ReturnType<typeof setupFakeGoogleClient>['getJson']) {
  return getJson.mock.calls.filter(([path]) => path !== '/users/me/calendarList')
}

describe('WeekPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
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

  describe('kalendervalg', () => {
    const TWO = [calendarEntry('a', { selected: true }), calendarEntry('b', { selected: false })]

    it('listar alla kalendrar med Googles val ikryssade', async () => {
      await renderPage({ calendars: TWO })
      await screen.findByText('Händelse from-a')

      expect(screen.getByRole('checkbox', { name: 'a' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'b' })).not.toBeChecked()
      expect(screen.queryByRole('button', { name: 'Återställ till Googles val' })).toBeNull()
    })

    it('visar flera kalendrar samtidigt och döljer en som avmarkeras', async () => {
      const { user, getJson } = await renderPage({ calendars: TWO })
      await screen.findByText('Händelse from-a')

      await user.click(screen.getByRole('checkbox', { name: 'b' }))
      expect(await screen.findByText('Händelse from-b')).toBeInTheDocument()
      expect(screen.getByText('Händelse from-a')).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'a' }))
      await waitFor(() => {
        expect(screen.queryByText('Händelse from-a')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Händelse from-b')).toBeInTheDocument()
      // a hämtades en gång och b en gång. Avmarkeringen gav inga nya anrop.
      expect(eventCalls(getJson)).toHaveLength(2)
    })

    it('sparar valet lokalt och återställer det vid nästa besök', async () => {
      const first = await renderPage({ calendars: TWO })
      await screen.findByText('Händelse from-a')
      await first.user.click(screen.getByRole('checkbox', { name: 'b' }))
      await screen.findByText('Händelse from-b')
      first.unmount()

      await renderPage({ calendars: TWO })

      expect(await screen.findByText('Händelse from-b')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'a' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'b' })).toBeChecked()
    })

    it('håller valet separat per användare', async () => {
      window.localStorage.setItem('sc:calendarSelection:other-user', JSON.stringify(['b']))

      await renderPage({ calendars: TWO })

      expect(await screen.findByText('Händelse from-a')).toBeInTheDocument()
      expect(screen.queryByText('Händelse from-b')).not.toBeInTheDocument()
    })

    it('går tillbaka till Googles val med Återställ', async () => {
      window.localStorage.setItem(`sc:calendarSelection:${TEST_USER.uid}`, JSON.stringify(['b']))
      const { user } = await renderPage({ calendars: TWO })
      expect(await screen.findByText('Händelse from-b')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Återställ till Googles val' }))

      expect(await screen.findByText('Händelse from-a')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByText('Händelse from-b')).not.toBeInTheDocument()
      })
      expect(window.localStorage.getItem(`sc:calendarSelection:${TEST_USER.uid}`)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Återställ till Googles val' })).toBeNull()
    })

    it('visar ett tydligt besked när inga kalendrar är valda', async () => {
      window.localStorage.setItem(`sc:calendarSelection:${TEST_USER.uid}`, JSON.stringify([]))

      await renderPage({ calendars: TWO })

      expect(await screen.findByTestId('calendar-empty')).toHaveTextContent(
        'Inga kalendrar är valda',
      )
      expect(screen.getByRole('checkbox', { name: 'a' })).not.toBeChecked()
    })

    it('ger kryssrutorna kalenderns namn och en grupp med etikett', async () => {
      await renderPage({ calendars: TWO })
      await screen.findByText('Händelse from-a')

      expect(screen.getByRole('group', { name: 'Kalendrar' })).toBeInTheDocument()
    })
  })

  describe('fellägen', () => {
    it('visar att Google eller servern inte svarar när åtkomstkontrollen är otillgänglig', async () => {
      await renderPage({
        responder: () => {
          throw new GoogleAccessError('google_unavailable')
        },
      })

      const alert = await screen.findByTestId('calendar-load-error')
      expect(alert).toHaveTextContent('Det gick inte att nå Google eller servern')
    })

    it('ber om att få försöka igen vid begränsning hos Google', async () => {
      await renderPage({
        responder: () => {
          throw new GoogleApiError('rateLimited', 429)
        },
      })

      expect(await screen.findByTestId('calendar-load-error')).toHaveTextContent(
        'Google har tillfälligt begränsat',
      )
    })

    it('visar ett fel i stället för en tom vecka när händelserna inte går att hämta på grund av åtkomst', async () => {
      await renderPage({
        events: () => {
          throw new GoogleAccessError('unknown')
        },
      })

      expect(await screen.findByTestId('calendar-access-error')).toBeInTheDocument()
    })

    it('behåller det som visas och varnar när en uppdatering misslyckas', async () => {
      let failing = false
      const { queryClient, user } = await renderPage({
        responder: (path) => {
          if (failing) throw new GoogleApiError('network', 0)
          return path === '/users/me/calendarList'
            ? { items: [calendarEntry('a', { selected: true })] }
            : { items: [eventItem('from-a')] }
        },
      })
      await screen.findByText('Händelse from-a')

      failing = true
      await act(() => queryClient.invalidateQueries())

      const stale = await screen.findByTestId('calendar-stale')
      expect(stale).toHaveTextContent('Kunde inte uppdatera')
      // Datan försvinner inte och vyn byts inte mot en felskärm.
      expect(screen.getByText('Händelse from-a')).toBeInTheDocument()
      expect(screen.queryByTestId('calendar-load-error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('calendar-events-error')).not.toBeInTheDocument()

      failing = false
      await user.click(within(stale).getByRole('button', { name: 'Försök igen' }))
      await waitFor(() => {
        expect(screen.queryByTestId('calendar-stale')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Händelse from-a')).toBeInTheDocument()
    })
  })
})
