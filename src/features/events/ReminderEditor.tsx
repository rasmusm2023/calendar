import { X } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import type { EventReminders, Reminder } from '@/types'
import { useReminderLabel } from './reminderLabel'

/** Tiderna som finns att välja bland, i minuter före start. En befintlig påminnelse med annan tid visas också. */
const PRESET_MINUTES: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440, 10080]

const NEW_REMINDER: Reminder = { method: 'popup', minutes: 10 }

export interface ReminderEditorProps {
  value: EventReminders
  /** Kalenderns standardpåminnelser. Visas när händelsen använder dem. */
  defaults: readonly Reminder[]
  onChange: (value: EventReminders) => void
}

/**
 * Redigerar påminnelserna för en händelse: antingen kalenderns standard eller en egen lista med tid och metod
 * (avisering eller e-post). Ett val av "egen lista" börjar med standardpåminnelserna, så att inget försvinner
 * av misstag.
 */
export function ReminderEditor({ value, defaults, onChange }: ReminderEditorProps) {
  const { t } = useTranslation()
  const label = useReminderLabel()
  const headingId = useId()
  const defaultToggleId = useId()

  const overrides = value.useDefault ? defaults : value.overrides
  const setOverrides = (next: readonly Reminder[]) => {
    onChange({ useDefault: false, overrides: next })
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h3 id={headingId} className="text-sm font-medium">
        {t('event.reminder.heading')}
      </h3>

      <div className="flex items-center gap-2">
        <input
          id={defaultToggleId}
          type="checkbox"
          className="size-4 accent-primary"
          checked={value.useDefault}
          onChange={(event) => {
            if (event.target.checked) onChange({ useDefault: true })
            else setOverrides(defaults)
          }}
        />
        <label htmlFor={defaultToggleId} className="text-sm">
          {t('event.reminder.useDefault')}
        </label>
      </div>

      {value.useDefault ? (
        <ul
          className="grid gap-1 text-sm text-muted-foreground"
          aria-label={t('event.reminder.heading')}
        >
          {defaults.length === 0 ? (
            <li>{t('event.reminder.defaultNone')}</li>
          ) : (
            defaults.map((reminder, index) => (
              <li key={index}>
                {label(reminder.minutes)} · {t(`event.reminder.methods.${reminder.method}`)}
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className="grid gap-2">
          {overrides.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('event.reminder.none')}</p>
          )}
          {overrides.map((reminder, index) => {
            const number = index + 1
            const minutes = PRESET_MINUTES.includes(reminder.minutes)
              ? PRESET_MINUTES
              : [...PRESET_MINUTES, reminder.minutes].sort((a, b) => a - b)
            const replace = (patch: Partial<Reminder>) => {
              setOverrides(
                overrides.map((item, at) => (at === index ? { ...item, ...patch } : item)),
              )
            }
            return (
              <div key={index} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <NativeSelect
                  aria-label={t('event.reminder.time', { index: number })}
                  value={reminder.minutes}
                  onChange={(event) => {
                    replace({ minutes: Number(event.target.value) })
                  }}
                >
                  {minutes.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={t('event.reminder.method', { index: number })}
                  value={reminder.method}
                  onChange={(event) => {
                    replace({ method: event.target.value === 'email' ? 'email' : 'popup' })
                  }}
                >
                  <option value="popup">{t('event.reminder.methods.popup')}</option>
                  <option value="email">{t('event.reminder.methods.email')}</option>
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('event.reminder.remove', { index: number })}
                  onClick={() => {
                    setOverrides(overrides.filter((_, at) => at !== index))
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setOverrides([...overrides, NEW_REMINDER])
              }}
            >
              {t('event.reminder.add')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
