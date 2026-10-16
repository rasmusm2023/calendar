import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { CalendarInfo } from '@/types'

interface CalendarPickerProps {
  calendars: readonly CalendarInfo[]
  isVisible: (calendarId: string) => boolean
  onToggle: (calendarId: string) => void
  /** Visa "Återställ" när användaren har ett eget val. */
  isCustom: boolean
  onReset: () => void
}

/** Lista med kryssrutor för vilka kalendrar som visas. Färgrutan är kalenderns färg från Google. */
export function CalendarPicker({
  calendars,
  isVisible,
  onToggle,
  isCustom,
  onReset,
}: CalendarPickerProps) {
  const { t } = useTranslation()

  return (
    <fieldset className="flex min-w-0 flex-col gap-1" data-testid="calendar-picker">
      <legend className="mb-1 text-sm font-semibold">{t('calendar.picker.label')}</legend>
      {calendars.map((calendar) => {
        const id = `calendar-picker-${calendar.id}`
        return (
          <label
            key={calendar.id}
            htmlFor={id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
          >
            <input
              id={id}
              type="checkbox"
              className="size-4 shrink-0 cursor-pointer"
              style={{ accentColor: calendar.backgroundColor }}
              checked={isVisible(calendar.id)}
              onChange={() => {
                onToggle(calendar.id)
              }}
            />
            <span className="truncate">{calendar.name}</span>
          </label>
        )
      })}
      {isCustom && (
        <Button variant="ghost" size="xs" className="mt-1 self-start" onClick={onReset}>
          {t('calendar.picker.reset')}
        </Button>
      )}
    </fieldset>
  )
}
