import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { AuthGate, AuthProvider } from '@/features/auth'
import { createI18n } from '@/i18n'
import { GoogleAccessError, type GoogleAccessReason } from '@/lib/google'
import { createFakeAuthService, TEST_USER, type InitialAuth } from '@/test/fakeAuthService'
import { createFakeGoogleAccessService } from '@/test/fakeGoogleAccessService'
import { useGoogleAccess } from './GoogleAccessContext'
import { GoogleAccessGate } from './GoogleAccessGate'
import { GoogleAccessProvider } from './GoogleAccessProvider'

function ReportButton({ error }: { error: unknown }) {
  const { reportAccessError } = useGoogleAccess()
  return (
    <button
      type="button"
      onClick={() => {
        reportAccessError(error)
      }}
    >
      rapportera
    </button>
  )
}

async function setup(
  google: 'connected' | GoogleAccessReason = 'connected',
  auth: InitialAuth = TEST_USER,
  reportError?: unknown,
) {
  const fakeAuth = createFakeAuthService(auth)
  const fakeGoogle = createFakeGoogleAccessService(google)
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={fakeAuth.service}>
        <GoogleAccessProvider service={fakeGoogle.service}>
          <AuthGate>
            <GoogleAccessGate>
              <div data-testid="app-content">app</div>
              {reportError !== undefined && <ReportButton error={reportError} />}
            </GoogleAccessGate>
          </AuthGate>
        </GoogleAccessProvider>
      </AuthProvider>
    </I18nextProvider>,
  )
  return { fakeAuth, fakeGoogle, user: userEvent.setup() }
}

describe('GoogleAccessGate', () => {
  it('släpper fram appen när Google redan är kopplat', async () => {
    const { fakeGoogle } = await setup('connected')

    expect(await screen.findByTestId('app-content')).toBeInTheDocument()
    expect(fakeGoogle.spies.getAccessToken).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('connect-google-screen')).not.toBeInTheDocument()
  })

  it('visar en laddningsindikator medan kopplingen kontrolleras', async () => {
    await setup('connected')
    expect(screen.getByRole('status', { name: 'Laddar…' })).toBeInTheDocument()
    await screen.findByTestId('app-content')
  })

  it('ber om koppling första gången och släpper sedan fram appen', async () => {
    const { fakeGoogle, user } = await setup('not_connected')

    expect(await screen.findByRole('heading', { name: 'Koppla Google Calendar' })).toBeVisible()
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Koppla Google Calendar' }))

    expect(await screen.findByTestId('app-content')).toBeInTheDocument()
    expect(fakeGoogle.spies.connect).toHaveBeenCalledWith(TEST_USER.email)
  })

  it('erbjuder "Koppla om" när åtkomsten har återkallats', async () => {
    const { user } = await setup('access_revoked')

    expect(
      await screen.findByRole('heading', { name: 'Åtkomsten till Google Calendar har upphört' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Koppla om' }))

    expect(await screen.findByTestId('app-content')).toBeInTheDocument()
  })

  it('går att logga ut från kopplingsskärmen (fel Google-konto)', async () => {
    const { user } = await setup('not_connected')

    await user.click(await screen.findByRole('button', { name: 'Logga ut' }))

    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
  })

  describe('när kopplingen misslyckas', () => {
    it('visar inget fel om användaren stänger Googles fönster', async () => {
      const { fakeGoogle, user } = await setup('not_connected')
      fakeGoogle.failNextConnectWithGis('cancelled')

      await user.click(await screen.findByRole('button', { name: 'Koppla Google Calendar' }))

      await waitFor(() => {
        expect(fakeGoogle.spies.connect).toHaveBeenCalled()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Koppla Google Calendar' })).toBeEnabled()
    })

    it('förklarar ett blockerat fönster och går att försöka igen direkt', async () => {
      const { fakeGoogle, user } = await setup('not_connected')
      fakeGoogle.failNextConnectWithGis('popupBlocked')

      await user.click(await screen.findByRole('button', { name: 'Koppla Google Calendar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Webbläsaren blockerade Googles fönster',
      )

      await user.click(screen.getByRole('button', { name: 'Koppla Google Calendar' }))
      expect(await screen.findByTestId('app-content')).toBeInTheDocument()
    })

    it.each([
      ['insufficient_scope', 'Du behöver godkänna åtkomst till din kalender'],
      ['no_refresh_token', 'Google gav ingen bestående åtkomst'],
      ['code_exchange_failed', 'gick inte att använda'],
      ['google_unavailable', 'Det gick inte att nå Google eller servern'],
      ['unknown', 'Något gick fel. Försök igen.'],
    ] as const)('visar ett begripligt fel för %s', async (reason, text) => {
      const { fakeGoogle, user } = await setup('not_connected')
      fakeGoogle.failNextConnect(new GoogleAccessError(reason))

      await user.click(await screen.findByRole('button', { name: 'Koppla Google Calendar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(text)
    })
  })

  describe('när kontrollen själv misslyckas', () => {
    it('visar ett fel med försök igen i stället för kopplingsskärmen', async () => {
      const { fakeGoogle, user } = await setup('google_unavailable')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Det gick inte att kontrollera kopplingen',
      )
      expect(screen.queryByTestId('connect-google-screen')).not.toBeInTheDocument()

      fakeGoogle.setConnected()
      await user.click(screen.getByRole('button', { name: 'Försök igen' }))

      expect(await screen.findByTestId('app-content')).toBeInTheDocument()
      expect(fakeGoogle.spies.getAccessToken).toHaveBeenCalledTimes(2)
    })
  })

  it('skickar användaren till "Koppla om" när ett Google-anrop rapporterar återkallad åtkomst', async () => {
    const { user } = await setup('connected', TEST_USER, new GoogleAccessError('access_revoked'))
    await screen.findByTestId('app-content')

    await user.click(screen.getByRole('button', { name: 'rapportera' }))

    expect(await screen.findByRole('button', { name: 'Koppla om' })).toBeVisible()
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()
  })

  it('ignorerar rapporterade fel som inte handlar om återkallad åtkomst', async () => {
    const { user } = await setup(
      'connected',
      TEST_USER,
      new GoogleAccessError('google_unavailable'),
    )
    await screen.findByTestId('app-content')

    await user.click(screen.getByRole('button', { name: 'rapportera' }))

    expect(screen.getByTestId('app-content')).toBeInTheDocument()
  })
})

describe('GoogleAccessProvider och inloggning', () => {
  it('kontrollerar inte åtkomst för en utloggad användare', async () => {
    const { fakeGoogle } = await setup('connected', null)

    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
    expect(fakeGoogle.spies.getAccessToken).not.toHaveBeenCalled()
  })

  it('kontrollerar åtkomst när användaren loggar in', async () => {
    const { fakeAuth, fakeGoogle } = await setup('connected', null)
    await screen.findByTestId('sign-in-screen')

    act(() => {
      fakeAuth.emit(TEST_USER)
    })

    expect(await screen.findByTestId('app-content')).toBeInTheDocument()
    expect(fakeGoogle.spies.getAccessToken).toHaveBeenCalledTimes(1)
  })

  it('glömmer token i minnet vid utloggning', async () => {
    const { fakeAuth, fakeGoogle } = await setup('connected')
    await screen.findByTestId('app-content')
    fakeGoogle.spies.clear.mockClear()

    act(() => {
      fakeAuth.emit(null)
    })

    expect(await screen.findByTestId('sign-in-screen')).toBeInTheDocument()
    expect(fakeGoogle.spies.clear).toHaveBeenCalled()
  })

  it('glömmer token och kontrollerar på nytt när en annan användare loggar in', async () => {
    const { fakeAuth, fakeGoogle } = await setup('connected')
    await screen.findByTestId('app-content')
    fakeGoogle.spies.clear.mockClear()
    fakeGoogle.spies.getAccessToken.mockClear()

    act(() => {
      fakeAuth.emit({ ...TEST_USER, uid: 'user-2', email: 'two@example.com' })
    })

    await waitFor(() => {
      expect(fakeGoogle.spies.getAccessToken).toHaveBeenCalledTimes(1)
    })
    expect(fakeGoogle.spies.clear).toHaveBeenCalled()
  })
})
