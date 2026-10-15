import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth'
import { createI18n } from '@/i18n'
import { createFakeAuthService, TEST_USER, type InitialAuth } from '@/test/fakeAuthService'
import { App } from './App'
import { ConfigErrorScreen } from './ConfigErrorScreen'

async function renderApp(initial: InitialAuth) {
  const fake = createFakeAuthService(initial)
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={fake.service}>
        <App />
      </AuthProvider>
    </I18nextProvider>,
  )
  return { fake, user: userEvent.setup() }
}

describe('App', () => {
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
