import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth'
import { GoogleAccessProvider } from '@/features/google-access'
import { UndoProvider } from '@/features/undo'
import { createI18n } from '@/i18n'
import { createFakeAuthService, TEST_USER, type InitialAuth } from '@/test/fakeAuthService'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import { createFakeGoogleAccessService } from '@/test/fakeGoogleAccessService'
import { App } from './App'
import { QueryProvider } from './QueryProvider'
import { ConfigErrorScreen } from './ConfigErrorScreen'

async function renderApp(initial: InitialAuth) {
  const fake = createFakeAuthService(initial)
  const google = createFakeGoogleAccessService('connected')
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={fake.service}>
        <GoogleAccessProvider service={google.service}>
          <QueryProvider>
            <UndoProvider>
              <App />
            </UndoProvider>
          </QueryProvider>
        </GoogleAccessProvider>
      </AuthProvider>
    </I18nextProvider>,
  )
  return { fake, user: userEvent.setup() }
}

describe('App', () => {
  beforeEach(() => {
    // Veckovyn hämtar kalendrar från Google. Här svarar vi med en tom lista.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ items: [] }))),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('visar appen med översatt etikett för en inloggad användare', async () => {
    await renderApp(TEST_USER)
    expect(await screen.findByTestId('app-root')).toHaveAccessibleName('Spaces Calendar')
  })

  it('visar inloggning för en utloggad användare', async () => {
    await renderApp(null)
    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('app-root')).not.toBeInTheDocument()
  })

  it('går att logga ut från appen', async () => {
    const { user } = await renderApp(TEST_USER)
    await user.click(await screen.findByRole('button', { name: 'Logga ut' }))
    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
  })
})

describe('App när åtkomsten återkallas under tiden', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('byter till "Koppla om" och visar händelserna igen efter ny koppling', async () => {
    let revoked = true
    const start = new Date()
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('/calendarList')) {
          return Promise.resolve(
            Response.json({
              items: [
                {
                  id: 'a',
                  summary: 'A',
                  accessRole: 'owner',
                  backgroundColor: TEST_CALENDAR_COLOR,
                  selected: true,
                },
              ],
            }),
          )
        }
        if (revoked) return Promise.resolve(new Response('{}', { status: 401 }))
        return Promise.resolve(
          Response.json({
            items: [
              {
                id: 'e1',
                etag: '"1"',
                summary: 'Planeringsmöte',
                start: { dateTime: start.toISOString() },
                end: { dateTime: end.toISOString() },
              },
            ],
          }),
        )
      }),
    )
    const { user } = await renderApp(TEST_USER)

    // Googles svar på händelseanropet (401 två gånger) betyder att åtkomsten är återkallad.
    const reconnect = await screen.findByRole('button', { name: 'Koppla om' })
    expect(screen.queryByTestId('app-root')).not.toBeInTheDocument()

    revoked = false
    await user.click(reconnect)

    expect(await screen.findByText('Planeringsmöte')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Koppla om' })).not.toBeInTheDocument()
  })
})
describe('ConfigErrorScreen', () => {
  it('visar rubrik, tips och teknisk detalj som en alert', async () => {
    const i18n = await createI18n('sv')
    render(
      <I18nextProvider i18n={i18n}>
        <ConfigErrorScreen details="VITE_FIREBASE_API_KEY: saknas" />
      </I18nextProvider>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Appen är inte konfigurerad')
    expect(alert).toHaveTextContent('.env.local')
    expect(alert).toHaveTextContent('VITE_FIREBASE_API_KEY: saknas')
  })
})
