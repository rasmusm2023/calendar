import { QueryClient } from '@tanstack/react-query'

const ONE_MINUTE_MS = 60_000

/**
 * Appens QueryClient. Google-klienten gör egna nya försök med väntetid (src/lib/google/client.ts),
 * så React Query försöker inte om ovanpå det. Data anses färsk i en minut och hämtas om när fönstret
 * får fokus eller nätet kommer tillbaka.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: ONE_MINUTE_MS,
        gcTime: 10 * ONE_MINUTE_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  })
}
