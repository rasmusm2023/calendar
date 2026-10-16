import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth'
import { useGoogleAccess } from '@/features/google-access'
import { createQueryClient } from '@/lib/query'

interface QueryProviderProps {
  children: ReactNode
  /** Byts ut i tester. */
  queryClient?: QueryClient
}

/**
 * Ger appen TanStack Query. Måste ligga inom AuthProvider och GoogleAccessProvider:
 * - Fel från Google-anrop rapporteras till GoogleAccessProvider, så att återkallad åtkomst leder till "Koppla om".
 * - Cachen töms när användaren loggar ut eller byts, så att inga kalenderdata läcker mellan konton.
 */
export function QueryProvider({ children, queryClient: provided }: QueryProviderProps) {
  const { state: auth } = useAuth()
  const { reportAccessError } = useGoogleAccess()
  const uid = auth.status === 'signedIn' ? auth.user.uid : null

  const [queryClient] = useState(() => provided ?? createQueryClient())

  // Varje misslyckad hämtning rapporteras. GoogleAccessProvider ignorerar allt utom återkallad åtkomst.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        reportAccessError(event.action.error)
      }
    })
  }, [queryClient, reportAccessError])

  useEffect(() => {
    return () => {
      queryClient.clear()
    }
  }, [uid, queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
