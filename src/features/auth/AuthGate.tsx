import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from './AuthContext'
import { SignInScreen } from './SignInScreen'

/** Visar laddning tills sparad session lästs, sedan inloggning eller appen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { state } = useAuth()

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t('common.loading')}
        className="flex min-h-svh items-center justify-center"
      >
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }

  if (state.status === 'signedOut') {
    return <SignInScreen />
  }

  return <>{children}</>
}
