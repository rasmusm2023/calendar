import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCalendars, useEventsForCalendars, type StyleContext } from '@/features/events'
import { getBrowserTimeZone, shiftWeekRange, weekRange } from '@/lib/dates'
import { GoogleAccessError, GoogleApiError } from '@/lib/google'
import { WeekCalendar } from './adapter/WeekCalendar'
import { CalendarPicker } from './CalendarPicker'
import { useCalendarSelection } from './useCalendarSelection'
import { WeekToolbar } from './WeekToolbar'
import { formatWeekSpan, weekNumber } from './weekTitle'

type LoadErrorKey = 'network' | 'unavailable' | 'rateLimited' | 'generic'

/**
 * Vilket meddelande som passar felet. Återkallad åtkomst hanteras inte här: GoogleAccessProvider tar emot
 * den och visar "Koppla om" i stället för veckovyn.
 */
function loadErrorKey(error: unknown): LoadErrorKey {
  if (error instanceof GoogleApiError) {
    if (error.kind === 'network') return 'network'
    if (error.kind === 'rateLimited' || error.kind === 'quotaExceeded') return 'rateLimited'
  }
  if (error instanceof GoogleAccessError && error.reason === 'google_unavailable') {
    return 'unavailable'
  }
  return 'generic'
}

/** Veckovyn: kalenderlista, händelser för veckan och navigering mellan veckor. Skrivskyddad i Fas 0. */
export function WeekPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('sv') ? 'sv' : 'en'
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const [anchor, setAnchor] = useState(() => new Date())
  const range = useMemo(() => weekRange(anchor, timeZone), [anchor, timeZone])

  const calendarsQuery = useCalendars()
  const allCalendars = useMemo(() => calendarsQuery.data?.calendars ?? [], [calendarsQuery.data])
  const selection = useCalendarSelection(allCalendars)
  const visibleCalendars = selection.visible
  const styleContext = useMemo<StyleContext>(
    () => ({
      calendarColors: new Map(visibleCalendars.map((c) => [c.id, c.backgroundColor])),
    }),
    [visibleCalendars],
  )

  // Har vi en kalenderlista, även om den senaste uppdateringen misslyckades, visas den och dess händelser.
  const hasCalendars = calendarsQuery.data !== undefined
  const week = useEventsForCalendars({
    calendars: visibleCalendars,
    range,
    timeZone,
    enabled: hasCalendars,
  })

  const goToWeek = (weeks: number) => {
    setAnchor(shiftWeekRange(range, weeks, timeZone).start)
  }

  const toolbar = (
    <WeekToolbar
      span={formatWeekSpan(range, timeZone, locale)}
      weekNumber={weekNumber(range)}
      isRefreshing={calendarsQuery.isFetching || (week.isFetching && !week.isPending)}
      onPrevious={() => {
        goToWeek(-1)
      }}
      onNext={() => {
        goToWeek(1)
      }}
      onToday={() => {
        setAnchor(new Date())
      }}
    />
  )

  if (!hasCalendars && calendarsQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        <div
          role="status"
          aria-busy="true"
          aria-label={t('common.loading')}
          data-testid="calendar-loading"
          className="flex-1 p-4"
        >
          <Skeleton className="h-full min-h-64 w-full" />
        </div>
      </div>
    )
  }

  if (!hasCalendars) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        <div className="p-4">
          <LoadErrorAlert
            testId="calendar-load-error"
            errorKey={loadErrorKey(calendarsQuery.error)}
            onRetry={() => {
              void calendarsQuery.refetch()
            }}
          />
        </div>
      </div>
    )
  }

  // Något gick inte att uppdatera, men det som hämtades tidigare visas fortfarande.
  const staleRefresh = calendarsQuery.isError || week.refreshFailures.length > 0
  const retryAll = () => {
    void calendarsQuery.refetch()
    week.refetch()
  }

  const notices = (
    <>
      {week.accessError && (
        <LoadErrorAlert
          testId="calendar-access-error"
          errorKey={loadErrorKey(week.accessError)}
          onRetry={week.refetch}
        />
      )}
      {week.failures.length > 0 && (
        <Alert variant="destructive" role="alert" data-testid="calendar-events-error">
          <AlertTitle>{t('calendar.eventsError.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('calendar.eventsError.description', {
                failed: week.failures.length,
                total: visibleCalendars.length,
              })}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={week.refetch}>
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {staleRefresh && (
        <Alert role="status" data-testid="calendar-stale">
          <AlertTitle>{t('calendar.stale.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('calendar.stale.description')}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={retryAll}>
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {week.truncatedCalendarIds.length > 0 && (
        <Alert data-testid="calendar-truncated">
          <AlertDescription>{t('calendar.truncated')}</AlertDescription>
        </Alert>
      )}
      {visibleCalendars.length === 0 && (
        <Alert data-testid="calendar-empty">
          <AlertDescription>
            {allCalendars.length === 0 ? t('calendar.noCalendars') : t('calendar.noneSelected')}
          </AlertDescription>
        </Alert>
      )}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {allCalendars.length > 0 && (
          <aside
            aria-label={t('calendar.picker.label')}
            className="max-h-40 shrink-0 overflow-y-auto border-b p-3 md:max-h-none md:w-56 md:border-r md:border-b-0"
          >
            <CalendarPicker
              calendars={allCalendars}
              isVisible={selection.isVisible}
              onToggle={selection.toggle}
              isCustom={selection.isCustom}
              onReset={selection.reset}
            />
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-col gap-2 px-4 pt-2 empty:hidden">{notices}</div>
          <div className="min-h-0 flex-1 p-2">
            <WeekCalendar
              events={week.events}
              styleContext={styleContext}
              date={anchor}
              locale={locale}
              ariaLabel={t('calendar.label')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface LoadErrorAlertProps {
  testId: string
  errorKey: LoadErrorKey
  onRetry: () => void
}

function LoadErrorAlert({ testId, errorKey, onRetry }: LoadErrorAlertProps) {
  const { t } = useTranslation()

  return (
    <Alert variant="destructive" role="alert" data-testid={testId}>
      <AlertTitle>{t('calendar.loadError.title')}</AlertTitle>
      <AlertDescription>
        <p>{t(`calendar.loadError.${errorKey}`)}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
