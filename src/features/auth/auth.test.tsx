import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { createI18n, type Locale } from '@/i18n'
import { createFakeAuthService, TEST_USER, type InitialAuth } from '@/test/fakeAuthService'
import { AuthGate, AuthProvider, SignInError, mapSignInError, useAuth } from './index'

async function renderGate(initial: InitialAuth = null, locale: Locale = 'sv') {
  const fake = createFakeAuthService(initial)
  const i18n = await createI18n(locale)
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={fake.service}>
        <AuthGate>
          <div data-testid="protected">hemligt innehåll</div>
        </AuthGate>
      </AuthProvider>
    </I18nextProvider>,
  )
  return { fake, view, user: userEvent.setup() }
}

describe('AuthGate', () => {
  it('visar laddning tills sparad session lästs, utan att blinka fram inloggningen', async () => {
    const { fake } = await renderGate('pending')
    expect(screen.getByRole('status', { name: 'Laddar…' })).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in-screen')).not.toBeInTheDocument()

    act(() => {
      fake.emit(TEST_USER)
    })
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('visar inloggning när ingen är inloggad och döljer det skyddade innehållet', async () => {
    await renderGate(null)
    expect(await screen.findByRole('button', { name: 'Logga in med Google' })).toBeEnabled()
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
  })

  it('visar innehållet direkt när en sparad session finns (ingen ny inloggning efter omladdning)', async () => {
    const { fake } = await renderGate(TEST_USER)
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(fake.spies.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('byter språk', async () => {
    await renderGate(null, 'en')
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
  })
})

describe('inloggning', () => {
  it('loggar in via knappen och visar sedan innehållet', async () => {
    const { fake, user } = await renderGate(null)
    await user.click(await screen.findByRole('button', { name: 'Logga in med Google' }))
    expect(fake.spies.signInWithGoogle).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
  })

  it('låser inte knappen under pågående inloggning, så att man kan försöka igen direkt', async () => {
    const { fake, user } = await renderGate(null)
    fake.service.signInWithGoogle = () => new Promise<void>(() => undefined) // väntar för alltid
    const button = await screen.findByRole('button', { name: 'Logga in med Google' })
    await user.click(button)
    expect(button).toBeEnabled()
    await user.click(button) // ett nytt försök är tillåtet
    expect(button).toBeEnabled()
  })

  it('ett avbrutet försök som avslutas medan ett nytt pågår visar inget fel', async () => {
    const { fake, user } = await renderGate(null)
    fake.failNextSignIn(new SignInError('cancelled'))
    const button = await screen.findByRole('button', { name: 'Logga in med Google' })
    await user.click(button)
    await user.click(button)
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('visar inget fel när användaren stänger fönstret, och går att försöka igen', async () => {
    const { fake, user } = await renderGate(null)
    fake.failNextSignIn(new SignInError('cancelled'))
    const button = await screen.findByRole('button', { name: 'Logga in med Google' })
    await user.click(button)
    await waitFor(() => {
      expect(button).toBeEnabled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(button)
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
  })

  it('visar tydligt fel när popup blockeras', async () => {
    const { fake, user } = await renderGate(null)
    fake.failNextSignIn(new SignInError('popupBlocked'))
    await user.click(await screen.findByRole('button', { name: 'Logga in med Google' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Inloggningen misslyckades')
    expect(alert).toHaveTextContent('blockerade')
  })

  it('visar ett allmänt fel för oväntade fel och rensar det vid nästa försök', async () => {
    const { fake, user } = await renderGate(null)
    fake.failNextSignIn(new Error('nätverket föll'))
    const button = await screen.findByRole('button', { name: 'Logga in med Google' })
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Något gick fel')

    await user.click(button)
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('går tillbaka till inloggning vid utloggning', async () => {
    const { fake } = await renderGate(TEST_USER)
    await screen.findByTestId('protected')
    await act(async () => {
      await fake.service.signOut()
    })
    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
  })

  it('avregistrerar lyssnaren när providern avmonteras', async () => {
    const { fake, view } = await renderGate(null)
    expect(fake.listenerCount()).toBe(1)
    view.unmount()
    expect(fake.listenerCount()).toBe(0)
  })
})

describe('useAuth', () => {
  it('kastar tydligt fel utanför AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/)
  })
})

describe('mapSignInError', () => {
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/popup-blocked', 'popupBlocked'],
    ['auth/network-request-failed', 'failed'],
    ['auth/internal-error', 'failed'],
  ])('mappar %s till %s', (code, kind) => {
    expect(mapSignInError(new FirebaseError(code, 'x')).kind).toBe(kind)
  })

  it('mappar okända fel till "failed" och bevarar orsaken', () => {
    const cause = new Error('boom')
    const mapped = mapSignInError(cause)
    expect(mapped.kind).toBe('failed')
    expect(mapped.cause).toBe(cause)
  })

  it('lämnar ett redan mappat fel orört', () => {
    const original = new SignInError('popupBlocked')
    expect(mapSignInError(original)).toBe(original)
  })
})
