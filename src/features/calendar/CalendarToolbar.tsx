import { CircleHelp, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  CALENDAR_VIEW_KINDS,
  MAX_DAYS,
  MIN_DAYS,
  type CalendarView,
  type CalendarViewKind,
} from './calendarView'

interface CalendarToolbarProps {
  /** Rubriken för perioden, t.ex. "19–25 okt. 2026". */
  title: string
  /** ISO-veckonummer, eller `null` när vyn inte hör till en enskild vecka. */
  weekNumber: number | null
  view: CalendarView
  onViewChange: (kind: CalendarViewKind) => void
  onDaysChange: (days: number) => void
  /** Något hämtas i bakgrunden medan det som redan finns visas. */
  isRefreshing: boolean
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  /** Skapa en händelse utan att peka i rutnätet. Knappen visas inte utan den. */
  onCreate?: () => void
  /** Öppnar listan över kortkommandon. */
  onShowShortcuts: () => void
}

const DAY_OPTIONS = Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => MIN_DAYS + i)

export function CalendarToolbar({
  title,
  weekNumber,
  view,
  onViewChange,
  onDaysChange,
  isRefreshing,
  onPrevious,
  onNext,
  onToday,
  onCreate,
  onShowShortcuts,
}: CalendarToolbarProps) {
  const { t } = useTranslation()

  return (
    <div
      role="toolbar"
      aria-label={t('calendar.toolbar.label')}
      className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
    >
      {onCreate && (
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t('event.create.toolbar')}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onToday}>
        {t('calendar.toolbar.today')}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(`calendar.toolbar.previous.${view.kind}`)}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(`calendar.toolbar.next.${view.kind}`)}
        onClick={onNext}
      >
        <ChevronRight aria-hidden="true" />
      </Button>

      <h2 className="text-lg font-semibold" aria-live="polite" data-testid="calendar-title">
        {title}
        {weekNumber !== null && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {t('calendar.weekNumber', { number: weekNumber })}
          </span>
        )}
      </h2>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Alltid i DOM:en så att skärmläsare får beskedet, men osynlig när inget uppdateras. */}
        <span role="status" className="text-sm text-muted-foreground">
          {isRefreshing ? t('calendar.refreshing') : ''}
        </span>

        {view.kind === 'days' && (
          <select
            aria-label={t('calendar.view.daysCount')}
            value={view.days}
            onChange={(event) => {
              onDaysChange(Number(event.target.value))
            }}
            className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days}
              </option>
            ))}
          </select>
        )}

        <div
          role="group"
          aria-label={t('calendar.view.label')}
          className="inline-flex gap-0.5 rounded-md border p-0.5"
        >
          {CALENDAR_VIEW_KINDS.map((kind) => {
            const active = view.kind === kind
            return (
              <Button
                key={kind}
                variant={active ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={active}
                onClick={() => {
                  onViewChange(kind)
                }}
              >
                {t(`calendar.view.${kind}`, { days: view.days })}
              </Button>
            )
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calendar.shortcuts.open')}
          onClick={onShowShortcuts}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
