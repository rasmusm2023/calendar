import { useTranslation } from 'react-i18next'
import { AuthGate, SignOutButton } from '@/features/auth'
import { GoogleAccessGate } from '@/features/google-access'

export function App() {
  const { t } = useTranslation()

  return (
    <AuthGate>
      <GoogleAccessGate>
        <div className="flex min-h-svh flex-col">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-semibold">{t('app.name')}</span>
            <SignOutButton />
          </header>
          {/* Platshållare. Veckovyn tillkommer i senare steg. */}
          <main data-testid="app-root" aria-label={t('app.name')} className="flex-1" />
        </div>
      </GoogleAccessGate>
    </AuthGate>
  )
}
