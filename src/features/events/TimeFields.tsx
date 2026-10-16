import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TimeForm } from './useTimeForm'

/**
 * Heldag, start och slut som datum- och tidsfält, med ett felmeddelande när tiderna inte hänger ihop.
 * Klockslagen göms för heldag. Ändras starten följer slutet med (längden behålls).
 */
export function TimeFields({ form, setForm, time, updateStart }: TimeForm) {
  const { t } = useTranslation()
  const ids = {
    allDay: useId(),
    startDate: useId(),
    startTime: useId(),
    endDate: useId(),
    endTime: useId(),
    error: useId(),
  }
  const invalid = time === null

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          id={ids.allDay}
          type="checkbox"
          className="size-4 accent-primary"
          checked={form.allDay}
          onChange={(event) => {
            setForm((current) => ({ ...current, allDay: event.target.checked }))
          }}
        />
        <Label htmlFor={ids.allDay}>{t('event.fields.allDay')}</Label>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.startDate}>{t('event.fields.startDate')}</Label>
          <Input
            id={ids.startDate}
            type="date"
            required
            value={form.startDate}
            onChange={(event) => {
              updateStart({ startDate: event.target.value })
            }}
          />
        </div>
        {!form.allDay && (
          <div className="grid gap-1.5">
            <Label htmlFor={ids.startTime}>{t('event.fields.startTime')}</Label>
            <Input
              id={ids.startTime}
              type="time"
              required
              value={form.startTime}
              onChange={(event) => {
                updateStart({ startTime: event.target.value })
              }}
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.endDate}>{t('event.fields.endDate')}</Label>
          <Input
            id={ids.endDate}
            type="date"
            required
            aria-invalid={invalid}
            aria-describedby={invalid ? ids.error : undefined}
            value={form.endDate}
            onChange={(event) => {
              setForm((current) => ({ ...current, endDate: event.target.value }))
            }}
          />
        </div>
        {!form.allDay && (
          <div className="grid gap-1.5">
            <Label htmlFor={ids.endTime}>{t('event.fields.endTime')}</Label>
            <Input
              id={ids.endTime}
              type="time"
              required
              aria-invalid={invalid}
              aria-describedby={invalid ? ids.error : undefined}
              value={form.endTime}
              onChange={(event) => {
                setForm((current) => ({ ...current, endTime: event.target.value }))
              }}
            />
          </div>
        )}
      </div>

      {invalid && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {t('event.fields.invalidTime')}
        </p>
      )}
    </>
  )
}
