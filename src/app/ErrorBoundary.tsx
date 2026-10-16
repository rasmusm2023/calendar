import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Anropas när något oväntat kraschar vid rendering. Byts ut i tester. */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Sista skyddsnätet: ett oväntat renderingsfel ger ett begripligt besked och ett sätt att komma vidare
 * i stället för en vit sida. Förväntade fel (nätverk, åtkomst) hanteras där de uppstår.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) this.props.onError(error, info)
    else console.error(error, info.componentStack)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return <CrashScreen />
  }
}

function CrashScreen() {
  const { t } = useTranslation()

  return (
    <main
      data-testid="crash-screen"
      className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6"
    >
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t('app.crash.title')}</AlertTitle>
        <AlertDescription>{t('app.crash.description')}</AlertDescription>
      </Alert>
      <Button
        size="lg"
        onClick={() => {
          window.location.reload()
        }}
      >
        {t('app.crash.reload')}
      </Button>
    </main>
  )
}
