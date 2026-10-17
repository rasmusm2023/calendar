import { X } from 'lucide-react'
import { Toast } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { UndoEvent, UndoManager } from '@/lib/undo'

const MAX_TOASTS = 5
const ERROR_DURATION_MS = 10_000
const INFO_DURATION_MS = 5_000

interface ToastItem {
  id: number
  tone: 'error' | 'info'
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface UndoToasterProps {
  manager: UndoManager
}

/**
 * Visar toasts för ändringar som misslyckats (med "Försök igen"), för borttagningar och liknande
 * som går att ångra, och bekräftelser när något ångrats eller gjorts om. Felmeddelanden är
 * `foreground` (läses upp direkt av skärmläsare), övriga `background`.
 */
export function UndoToaster({ manager }: UndoToasterProps) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const toItem = useCallback(
    (event: UndoEvent): Omit<ToastItem, 'id'> => {
      switch (event.type) {
        case 'failed':
          return {
            tone: 'error',
            message: t(`undo.failed.${event.action}`, { label: event.label }),
            actionLabel: t('common.retry'),
            onAction: event.retry,
          }
        case 'done':
          return {
            tone: 'info',
            message: event.label,
            actionLabel: t('undo.undo'),
            onAction: event.undo,
          }
        case 'undone':
          return {
            tone: 'info',
            message: t('undo.undone', { label: event.label }),
            actionLabel: t('undo.redo'),
            onAction: event.redo,
          }
        case 'redone':
          return { tone: 'info', message: t('undo.redone', { label: event.label }) }
      }
    },
    [t],
  )

  useEffect(() => {
    return manager.onEvent((event) => {
      const id = nextId.current
      nextId.current += 1
      setToasts((current) => [...current, { id, ...toItem(event) }].slice(-MAX_TOASTS))
    })
  }, [manager, toItem])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  return (
    <Toast.Provider label={t('undo.region')} swipeDirection="left">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          type={toast.tone === 'error' ? 'foreground' : 'background'}
          duration={toast.tone === 'error' ? ERROR_DURATION_MS : INFO_DURATION_MS}
          onOpenChange={(open) => {
            if (!open) remove(toast.id)
          }}
          data-tone={toast.tone}
          className="flex items-center gap-2 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md data-[tone=error]:border-destructive/50"
        >
          <Toast.Description className="flex-1">{toast.message}</Toast.Description>
          {toast.actionLabel !== undefined && toast.onAction !== undefined && (
            <Toast.Action altText={toast.actionLabel} asChild>
              <Button variant="outline" size="sm" onClick={toast.onAction}>
                {toast.actionLabel}
              </Button>
            </Toast.Action>
          )}
          <Toast.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('undo.dismiss')}>
              <X aria-hidden="true" />
            </Button>
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed bottom-4 left-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] list-none flex-col gap-2 outline-none" />
    </Toast.Provider>
  )
}
