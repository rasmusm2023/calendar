import { useTranslation } from 'react-i18next'
import { AuthGate, SignOutButton } from '@/features/auth'
import { CalendarPage } from '@/features/calendar'
import { GoogleAccessGate } from '@/features/google-access'

export function App() {
  const { t } = useTranslation()

  return (
    <AuthGate>
      <GoogleAccessGate>
        <div className="flex h-svh flex-col">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-semibold">{t('app.name')}</span>
            <SignOutButton />
          </header>
          <main
            data-testid="app-root"
            aria-label={t('app.name')}
            className="flex min-h-0 flex-1 flex-col"
          >
            <CalendarPage />
          </main>
        </div>
      </GoogleAccessGate>
    </AuthGate>
  )
}
