import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from './AuthContext'

export function SignInScreen() {
  const { t } = useTranslation()
  const { signIn, signInError } = useAuth()

  return (
    <main
      data-testid="sign-in-screen"
      className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
        <p className="text-muted-foreground">{t('auth.signIn.description')}</p>
      </div>

      {signInError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t('auth.signIn.errorTitle')}</AlertTitle>
          <AlertDescription>{t(`auth.signIn.error.${signInError}`)}</AlertDescription>
        </Alert>
      )}

      {/*
        Knappen är medvetet aldrig låst. Stänger användaren popup-fönstret märker Firebase det först
        efter några sekunder, och ett nytt klick ska då kunna försöka igen direkt. Firebase avbryter
        det gamla försöket (auth/cancelled-popup-request), och det tolkas som "avbrutet".
      */}
      <Button
        onClick={() => {
          void signIn()
        }}
        size="lg"
      >
        {t('auth.signIn.button')}
      </Button>
    </main>
  )
}
