import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SignOutButton } from '@/features/auth'
import type { ReconnectReason } from '@/lib/google'
import { useGoogleAccess } from './GoogleAccessContext'

/** Första gången ("Koppla") eller när åtkomsten återkallats ("Koppla om"). */
export function ConnectGoogleScreen({ reason }: { reason: ReconnectReason }) {
  const { t } = useTranslation()
  const { connect, connectFailure } = useGoogleAccess()
  const kind = reason === 'access_revoked' ? 'reconnect' : 'connect'

  return (
    <main
      data-testid="connect-google-screen"
      className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t(`googleAccess.${kind}.title`)}</h1>
        <p className="text-muted-foreground">{t(`googleAccess.${kind}.description`)}</p>
      </div>

      {connectFailure && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t('googleAccess.errorTitle')}</AlertTitle>
          <AlertDescription>{t(`googleAccess.error.${connectFailure}`)}</AlertDescription>
        </Alert>
      )}

      {/* Aldrig låst: stänger användaren Googles fönster ska ett nytt klick kunna försöka igen direkt. */}
      <Button
        onClick={() => {
          void connect()
        }}
        size="lg"
      >
        {t(`googleAccess.${kind}.button`)}
      </Button>

      {/* Fel Google-konto? Då ska man kunna logga ut härifrån. */}
      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </main>
  )
}
