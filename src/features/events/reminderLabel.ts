import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

/** Skriver en påminnelsetid som "15 minuter före", "2 timmar före" eller "1 dag före". Väljer störst jämna enhet. */
export function useReminderLabel(): (minutes: number) => string {
  const { t } = useTranslation()
  return useCallback(
    (minutes) => {
      if (minutes === 0) return t('event.reminder.before.atStart')
      if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) {
        return t('event.reminder.before.days', { count: minutes / MINUTES_PER_DAY })
      }
      if (minutes > 0 && minutes % MINUTES_PER_HOUR === 0) {
        return t('event.reminder.before.hours', { count: minutes / MINUTES_PER_HOUR })
      }
      return t('event.reminder.before.minutes', { count: minutes })
    },
    [t],
  )
}
