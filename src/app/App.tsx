import { useTranslation } from 'react-i18next'

export function App() {
  const { t } = useTranslation()
  // Platshållare. Layout och innehåll tillkommer i senare steg.
  return <main data-testid="app-root" aria-label={t('app.name')} />
}
