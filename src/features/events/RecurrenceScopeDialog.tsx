import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { RecurringScope } from './recurringScope'

const SCOPES: readonly RecurringScope[] = ['this', 'following', 'all']

export interface RecurrenceScopeDialogProps {
  /** Vad som ska göras med serien. Styr rubriken. */
  mode: 'edit' | 'delete'
  onConfirm: (scope: RecurringScope) => void
  onCancel: () => void
  /**
   * Dit fokus ska när frågan stängs. Utan den återställer dialogen fokus själv. Används när händelsen
   * i rutnätet kan ha ritats om, så att det element som hade fokus inte finns kvar.
   */
  restoreFocus?: () => void
}

/**
 * Frågan som ställs innan en återkommande händelse ändras eller tas bort (PRD 6.7): bara den här, den här och
 * följande, eller alla. "Bara den här" är förvalt, eftersom det är minst ingripande. Esc och Avbryt gör ingenting.
 */
export function RecurrenceScopeDialog({
  mode,
  onConfirm,
  onCancel,
  restoreFocus,
}: RecurrenceScopeDialogProps) {
  const { t } = useTranslation()
  const groupId = useId()
  const [scope, setScope] = useState<RecurringScope>('this')

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent
        data-testid="recurrence-scope"
        onCloseAutoFocus={(focusEvent) => {
          if (restoreFocus === undefined) return
          focusEvent.preventDefault()
          restoreFocus()
        }}
      >
        <DialogTitle>
          {t(mode === 'edit' ? 'event.recurrence.editTitle' : 'event.recurrence.deleteTitle')}
        </DialogTitle>
        <DialogDescription>{t('event.recurrence.description')}</DialogDescription>
        <RadioGroup
          value={scope}
          onValueChange={(value) => {
            const next = SCOPES.find((option) => option === value)
            if (next !== undefined) setScope(next)
          }}
          aria-label={t('event.recurrence.description')}
        >
          {SCOPES.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem value={option} id={`${groupId}-${option}`} />
              <Label htmlFor={`${groupId}-${option}`}>
                {t(`event.recurrence.scope.${option}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('event.recurrence.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm(scope)
            }}
          >
            {t('event.recurrence.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
