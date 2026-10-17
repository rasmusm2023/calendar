import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'

const GROUPS = [
  {
    id: 'navigate',
    rows: ['day', 'week', 'days', 'month', 'agenda', 'today', 'next', 'previous'],
  },
  { id: 'events', rows: ['create', 'edit', 'delete', 'duplicate'] },
  { id: 'history', rows: ['undo', 'redo', 'help'] },
] as const

export interface ShortcutHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Listan över kortkommandon (PRD 6.9). Öppnas med ? eller knappen i verktygsraden. */
export function ShortcutHelp({ open, onOpenChange }: ShortcutHelpProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcut-help" className="max-w-md">
        <DialogTitle>{t('calendar.shortcuts.title')}</DialogTitle>
        <DialogDescription>{t('calendar.shortcuts.description')}</DialogDescription>
        <div className="grid gap-4">
          {GROUPS.map((group) => (
            <section key={group.id} className="grid gap-1">
              <h3 className="text-sm font-medium">{t(`calendar.shortcuts.groups.${group.id}`)}</h3>
              <ul className="grid gap-1">
                {group.rows.map((row) => (
                  <li key={row} className="flex items-baseline justify-between gap-4 text-sm">
                    <span>{t(`calendar.shortcuts.keys.${row}`)}</span>
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {t(`calendar.shortcuts.combos.${row}`)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {t('calendar.shortcuts.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
