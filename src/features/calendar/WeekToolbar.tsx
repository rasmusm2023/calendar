import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface WeekToolbarProps {
  /** Veckans datumspann, t.ex. "19–25 okt. 2026". */
  span: string
  weekNumber: number
  /** Något hämtas i bakgrunden medan det som redan finns visas. */
  isRefreshing: boolean
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}

export function WeekToolbar({
  span,
  weekNumber,
  isRefreshing,
  onPrevious,
  onNext,
  onToday,
}: WeekToolbarProps) {
  const { t } = useTranslation()

  return (
    <div
      role="toolbar"
      aria-label={t('calendar.toolbar.label')}
      className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
    >
      <Button variant="outline" size="sm" onClick={onToday}>
        {t('calendar.toolbar.today')}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.toolbar.previous')}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.toolbar.next')}
        onClick={onNext}
      >
        <ChevronRight aria-hidden="true" />
      </Button>

      <h2 className="text-lg font-semibold" aria-live="polite" data-testid="week-title">
        {span}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {t('calendar.weekNumber', { number: weekNumber })}
        </span>
      </h2>

      {/* Alltid i DOM:en så att skärmläsare får beskedet, men osynlig när inget uppdateras. */}
      <span role="status" className="ml-auto text-sm text-muted-foreground">
        {isRefreshing ? t('calendar.refreshing') : ''}
      </span>
    </div>
  )
}
