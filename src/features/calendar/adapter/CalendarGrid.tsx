import type { CalendarOptions, DateSelectArg, DatesSetArg, EventMountArg } from '@fullcalendar/core'
import svLocale from '@fullcalendar/core/locales/sv'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, {
  type DateClickArg as FullCalendarDateClickArg,
} from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { StyleContext } from '@/features/events'
import { getBrowserTimeZone } from '@/lib/dates'
import type { EventTime } from '@/lib/google'
import type { CalEvent } from '@/types'
import {
  AGENDA_DAYS,
  MAX_DAYS,
  MIN_DAYS,
  clampDays,
  visibleRange,
  type CalendarView,
} from '../calendarView'
import {
  DRAFT_EVENT_ID,
  toFullCalendarDraft,
  toFullCalendarEvents,
  type GridDraft,
} from './mapEvents'
import { scrollTimeForNow } from './scrollTime'
import { eventTimeFromClick, eventTimeFromSelection } from './selection'
import './calendarGrid.css'

const PLUGINS = [timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]
const LOCALES = [svLocale]
const CLOCK_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false } as const
const DAY_HEADER_FORMAT = { weekday: 'short', day: 'numeric', month: 'numeric' } as const
const MONTH_HEADER_FORMAT = { weekday: 'short' } as const
const MONDAY = 1
const DEFAULT_SCROLL_TIME = '07:00:00'

const MONTH_VIEW = 'dayGridMonth'

/** Snäppning av markeringar i tidsrutnätet (PRD 6.4: 15 min). */
const SNAP_DURATION = '00:15:00'
/** Hur långt musen måste dras innan det räknas som en dragning och inte som ett klick. */
const SELECT_MIN_DISTANCE_PX = 4

/** Namnet på vyn hos FullCalendar. Det är bara adaptern som känner till dem. */
function fcViewName(view: CalendarView): string {
  switch (view.kind) {
    case 'day':
      return 'scDay'
    case 'week':
      return 'scWeek'
    case 'days':
      return `scDays${String(clampDays(view.days))}`
    case 'month':
      return MONTH_VIEW
    case 'agenda':
      return 'scAgenda'
  }
}

/**
 * Ger FullCalendar exakt det intervall som `visibleRange` räknar ut, så att det vi hämtar och det som
 * ritas alltid är detsamma. Tider räknas i webbläsarens zon, vilket är kalenderns (`timeZone: 'local'`).
 */
function rangeFor(view: CalendarView) {
  return (current: Date) => {
    const range = visibleRange(view, current, getBrowserTimeZone())
    return { start: new Date(range.start.getTime()), end: new Date(range.end.getTime()) }
  }
}

function buildViews(): CalendarOptions['views'] {
  const views: NonNullable<CalendarOptions['views']> = {
    scDay: { type: 'timeGrid', visibleRange: rangeFor({ kind: 'day', days: 1 }) },
    scWeek: { type: 'timeGrid', visibleRange: rangeFor({ kind: 'week', days: 7 }) },
    scAgenda: {
      type: 'list',
      visibleRange: rangeFor({ kind: 'agenda', days: AGENDA_DAYS }),
    },
    [MONTH_VIEW]: {
      // Hela veckor, utan fast antal. Samma intervall som `monthGridRange`.
      fixedWeekCount: false,
      weekNumbers: true,
      dayMaxEvents: true,
      dayHeaderFormat: MONTH_HEADER_FORMAT,
    },
  }
  // En vy per antal dagar: FullCalendars vyer är statiska, så N dagar får ett namn per N.
  for (let days = MIN_DAYS; days <= MAX_DAYS; days += 1) {
    views[`scDays${String(days)}`] = {
      type: 'timeGrid',
      visibleRange: rangeFor({ kind: 'days', days }),
    }
  }
  return views
}

export interface CalendarGridProps {
  events: readonly CalEvent[]
  /** Ger händelsernas färger. Bör vara memoiserad, annars byggs alla händelser om vid varje rendering. */
  styleContext: StyleContext
  /** Vilken vy som visas. */
  view: CalendarView
  /** Ett ögonblick i perioden som ska visas. Intervallet räknas ut ur vyn och datumet. */
  date: Date
  /** 'sv' eller 'en'. */
  locale: string
  /** Tillgängligt namn för kalenderområdet. */
  ariaLabel: string
  /** Månadsvyn visar tidsbestämda händelser som fyllda block (standard) i stället för prickar. */
  monthFilledBlocks?: boolean
  /**
   * Användaren klickade eller drog i rutnätet för att skapa en händelse. Får tiden som en ny händelse skulle ha.
   * Utan den går det inte att markera något i rutnätet.
   */
  onSelectTime?: (time: EventTime) => void
  /** Utkastet för händelsen som håller på att skapas. Ritas som en vanlig händelse tills det tas bort. */
  draft?: GridDraft | null
  /** Anropas med utkastets element när det ritats, så att t.ex. en popover kan peka på det. */
  onDraftElement?: (element: HTMLElement) => void
  /** Text för händelser utan titel. */
  untitledLabel?: string
}

/**
 * Kalenderrutnätet: dag, vecka, N dagar, månad och schema. Det enda stället som känner till
 * FullCalendar (PROJECT.md 2). Resten av appen ger oss CalEvent, vy och datum och får inget
 * FullCalendar-specifikt tillbaka.
 *
 * Tider visas i webbläsarens tidszon (`timeZone: 'local'`). FullCalendar kan inte räkna med namngivna
 * tidszoner utan extra plugin, och tills inställningen för tidszon finns är användarens zon webbläsarens.
 */
export function CalendarGrid({
  events,
  styleContext,
  view,
  date,
  locale,
  ariaLabel,
  monthFilledBlocks = true,
  onSelectTime,
  draft = null,
  onDraftElement,
  untitledLabel = '',
}: CalendarGridProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const calendarEvents = useMemo(() => {
    const inputs = toFullCalendarEvents(events, styleContext, untitledLabel)
    return draft ? [...inputs, toFullCalendarDraft(draft, styleContext)] : inputs
  }, [events, styleContext, untitledLabel, draft])
  const views = useMemo(() => buildViews(), [])

  // Vy och datum styr kalendern. Används tiden som beroende så att en ny Date med samma värde inte flyttar vyn.
  const viewName = fcViewName(view)
  const time = date.getTime()
  useEffect(() => {
    const api = calendarRef.current?.getApi()
    if (!api) return
    if (api.view.type === viewName) api.gotoDate(new Date(time))
    else api.changeView(viewName, new Date(time))
  }, [viewName, time])

  // Automatisk scroll till aktuell tid (PRD 6.2) när perioden som visas innehåller "nu". Annars behålls
  // scrollningen, så att bläddring mellan veckor inte hoppar. Gäller bara tidsrutnätet.
  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const now = new Date()
    if (arg.start.getTime() <= now.getTime() && now.getTime() < arg.end.getTime()) {
      arg.view.calendar.scrollToTime(scrollTimeForNow(now))
    }
  }, [])

  // Markering och klick i rutnätet blir en tid för en ny händelse. Den inbyggda markeringen tas bort direkt:
  // utkastet (draft) tar över och visar var händelsen hamnar.
  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      arg.view.calendar.unselect()
      onSelectTime?.(eventTimeFromSelection(arg, getBrowserTimeZone()))
    },
    [onSelectTime],
  )
  const handleDateClick = useCallback(
    (arg: FullCalendarDateClickArg) => {
      onSelectTime?.(eventTimeFromClick(arg, getBrowserTimeZone()))
    },
    [onSelectTime],
  )
  const handleEventDidMount = useCallback(
    (arg: EventMountArg) => {
      if (arg.event.id === DRAFT_EVENT_ID) onDraftElement?.(arg.el)
    },
    [onDraftElement],
  )

  return (
    <div className="sc-calendar-grid" role="region" aria-label={ariaLabel}>
      <FullCalendar
        ref={calendarRef}
        plugins={PLUGINS}
        locales={LOCALES}
        locale={locale}
        views={views}
        initialView={viewName}
        initialDate={date}
        headerToolbar={false}
        firstDay={MONDAY}
        weekNumberCalculation="ISO"
        timeZone="local"
        events={calendarEvents}
        // Fyllda block även för tidsbestämda händelser i månadsvyn (PRD 6.2), i stället för en liten prick.
        // Ställs in här och inte per vy, eftersom FullCalendar läser den från kalenderns egna inställningar.
        eventDisplay={monthFilledBlocks ? 'block' : 'auto'}
        editable={false}
        selectable={onSelectTime !== undefined}
        selectMinDistance={SELECT_MIN_DISTANCE_PX}
        snapDuration={SNAP_DURATION}
        select={handleSelect}
        dateClick={handleDateClick}
        eventDidMount={handleEventDidMount}
        eventInteractive
        nowIndicator
        allDaySlot
        height="100%"
        expandRows
        scrollTime={DEFAULT_SCROLL_TIME}
        scrollTimeReset={false}
        datesSet={handleDatesSet}
        slotLabelFormat={CLOCK_FORMAT}
        eventTimeFormat={CLOCK_FORMAT}
        dayHeaderFormat={DAY_HEADER_FORMAT}
      />
    </div>
  )
}
