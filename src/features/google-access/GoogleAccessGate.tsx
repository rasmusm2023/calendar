import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SignOutButton } from '@/features/auth'
import { ConnectGoogleScreen } from './ConnectGoogleScreen'
import { useGoogleAccess } from './GoogleAccessContext'

/**
 * Släpper bara fram appen när Google Calendar är kopplat. Ska ligga inom AuthGate och
 * GoogleAccessProvider.
 */
export function GoogleAccessGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { state, recheck } = useGoogleAccess()

  switch (state.status) {
    case 'idle':
      return null

    case 'checking':
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

    case 'needsConnection':
      return <ConnectGoogleScreen reason={state.reason} />

    case 'error':
      return (
        <main
          data-testid="google-access-error"
          className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6"
        >
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('googleAccess.checkError.title')}</AlertTitle>
            <AlertDescription>{t('googleAccess.checkError.description')}</AlertDescription>
          </Alert>
          <Button onClick={recheck} size="lg">
            {t('common.retry')}
          </Button>
          <div className="flex justify-center">
            <SignOutButton />
          </div>
        </main>
      )

    case 'connected':
      return <>{children}</>
  }
}
