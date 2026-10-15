import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAuth } from './AuthContext'

export function SignOutButton() {
  const { t } = useTranslation()
  const { signOut } = useAuth()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void signOut()
      }}
    >
      {t('auth.signOut')}
    </Button>
  )
}
