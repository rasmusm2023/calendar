import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { GoogleAccessContext, type GoogleAccessContextValue } from '@/features/google-access'
import type { GoogleClient, QueryParams } from '@/lib/google'
import { createQueryClient } from '@/lib/query'

export type Responder = (path: string, params: QueryParams) => unknown

/**
 * Wrapper med en fejkad Google-klient och ett eget QueryClient. `responder` svarar för varje anrop med
 * JSON (eller kastar ett fel, som den riktiga klienten gör).
 */
export function setupFakeGoogleClient(responder: Responder) {
  const getJson = vi.fn((path: string, params: QueryParams = {}) =>
    Promise.resolve().then(() => responder(path, params)),
  )
  const client: GoogleClient = {
    getJson: (path, params) => getJson(path, params),
    requestJson: () =>
      Promise.reject(new Error('Skrivande anrop är inte fejkade i den här hjälparen')),
  }
  const queryClient = createQueryClient()
  const value: GoogleAccessContextValue = {
    state: { status: 'connected' },
    connectFailure: null,
    connect: () => Promise.resolve(),
    recheck: () => undefined,
    getAccessToken: () => Promise.resolve('token'),
    client,
    invalidateToken: () => undefined,
    reportAccessError: () => undefined,
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <GoogleAccessContext.Provider value={value}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </GoogleAccessContext.Provider>
    )
  }
  return { Wrapper, getJson, queryClient }
}
