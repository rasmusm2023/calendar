import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Visas när miljökonfigurationen saknas eller är ogiltig, i stället för en tom vit sida. */
export function ConfigErrorScreen({ details }: { details: string }) {
  const { t } = useTranslation()
  return (
    <main
      data-testid="config-error-screen"
      className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 p-6"
    >
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t('app.configError.title')}</AlertTitle>
        <AlertDescription>
          <p>{t('app.configError.hint')}</p>
          {/* Teknisk diagnostik för utvecklaren (från miljövalideringen). */}
          <pre className="mt-2 text-xs whitespace-pre-wrap">{details}</pre>
        </AlertDescription>
      </Alert>
    </main>
  )
}
