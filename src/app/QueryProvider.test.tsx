import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/features/auth'
import { GoogleAccessGate, GoogleAccessProvider } from '@/features/google-access'
import { createI18n } from '@/i18n'
import { GoogleAccessError } from '@/lib/google'
import { createFakeAuthService, TEST_USER } from '@/test/fakeAuthService'
import { createFakeGoogleAccessService } from '@/test/fakeGoogleAccessService'
import { QueryProvider } from './QueryProvider'

interface ProbeProps {
  onClient: (client: QueryClient) => void
  fail?: boolean
}

function Probe({ onClient, fail = false }: ProbeProps) {
  const client = useQueryClient()
  onClient(client)
  useQuery({
    queryKey: ['probe'],
    queryFn: () => {
      if (fail) return Promise.reject(new GoogleAccessError('access_revoked'))
      return Promise.resolve('data')
    },
  })
  return <p>probe</p>
}

async function renderProbe(props: ProbeProps) {
  const auth = createFakeAuthService(TEST_USER)
  const google = createFakeGoogleAccessService('connected')
  const i18n = await createI18n('sv')
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider service={auth.service}>
        <GoogleAccessProvider service={google.service}>
          <QueryProvider>
            <GoogleAccessGate>
              <Probe {...props} />
            </GoogleAccessGate>
          </QueryProvider>
        </GoogleAccessProvider>
      </AuthProvider>
    </I18nextProvider>,
  )
  return { auth }
}

describe('QueryProvider', () => {
  it('skickar användaren till "Koppla om" när en hämtning visar att åtkomsten är återkallad', async () => {
    await renderProbe({ onClient: () => undefined, fail: true })

    expect(await screen.findByRole('button', { name: 'Koppla om' })).toBeInTheDocument()
  })

  it('tömmer cachen när användaren loggar ut', async () => {
    let client: QueryClient | undefined
    const { auth } = await renderProbe({
      onClient: (value) => {
        client = value
      },
    })
    await waitFor(() => {
      expect(client?.getQueryData(['probe'])).toBe('data')
    })

    auth.emit(null)

    await waitFor(() => {
      expect(client?.getQueryData(['probe'])).toBeUndefined()
    })
  })
})
