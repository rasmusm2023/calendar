import type {
  CalendarOptions,
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventMountArg,
} from '@fullcalendar/core'
import svLocale from '@fullcalendar/core/locales/sv'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, {
  type DateClickArg as FullCalendarDateClickArg,
  type EventDragStartArg,
  type EventResizeDoneArg,
  type EventResizeStartArg,
} from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { z } from 'zod'
import type { StyleContext, UpdateEventTimeRequest } from '@/features/events'
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
import { eventTimeFromClick, eventTimeFromMovedEvent, eventTimeFromSelection } from './selection'
import { useDragCancel } from './useDragCancel'
import './calendarGrid.css'

const PLUGINS = [timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]
const LOCALES = [svLocale]
const CLOCK_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false } as const
const DAY_HEADER_FORMAT = { weekday: 'short', day: 'numeric', month: 'numeric' } as const
const MONTH_HEADER_FORMAT = { weekday: 'short' } as const
const MONDAY = 1
const DEFAULT_SCROLL_TIME = '07:00:00'

const MONTH_VIEW = 'dayGridMonth'

/** Det vi lagt i extendedProps för varje händelse (se 	oFullCalendarEvents). */
const CALENDAR_ID_ATTRIBUTE = 'scCalendarId'
const EVENT_ID_ATTRIBUTE = 'scEventId'
const eventPropsSchema = z.object({ calendarId: z.string(), eventId: z.string() })

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
  /** Kalendrar vars händelser går att dra och ändra längd på. Utan den är alla händelser låsta. */
  editableCalendarIds?: ReadonlySet<string>
  /**
   * Användaren släppte en händelse på ny plats eller ändrade dess längd. Får bara den nya tiden: ändringen ska göras
   * (optimistiskt) av den som tar emot den, och rutnätet ritas om från de nya händelserna.
   */
  onEventTimeChange?: (request: UpdateEventTimeRequest) => void
  /** Användaren klickade på (eller valde med tangentbordet) en händelse. Utkastet räknas inte. */
  onEventClick?: (ref: EventRef) => void
  /** Delete eller Backspace på en händelse som har tangentbordsfokus. Den som tar emot avgör om den får tas bort. */
  onEventDelete?: (ref: EventRef) => void
  /** Ctrl/Cmd+D på en händelse som har tangentbordsfokus. */
  onEventDuplicate?: (ref: EventRef) => void
  /** Användaren släppte en händelse på ny plats med Alt nedtryckt: gör en kopia där i stället för att flytta. */
  onEventCopy?: (ref: EventRef, to: EventTime) => void
}

export interface EventRef {
  calendarId: string
  eventId: string
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
  editableCalendarIds,
  onEventTimeChange,
  onEventClick,
  onEventDelete,
  onEventDuplicate,
  onEventCopy,
}: CalendarGridProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const calendarEvents = useMemo(() => {
    const inputs = toFullCalendarEvents(events, styleContext, untitledLabel, editableCalendarIds)
    return draft ? [...inputs, toFullCalendarDraft(draft, styleContext)] : inputs
  }, [events, styleContext, untitledLabel, editableCalendarIds, draft])
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
      if (arg.event.id === DRAFT_EVENT_ID) {
        onDraftElement?.(arg.el)
        return
      }
      // Så att tangentbordshanteringen vet vilken händelse ett fokuserat element är.
      const props = eventPropsSchema.safeParse(arg.event.extendedProps)
      if (props.success) {
        arg.el.dataset[CALENDAR_ID_ATTRIBUTE] = props.data.calendarId
        arg.el.dataset[EVENT_ID_ATTRIBUTE] = props.data.eventId
      }
    },
    [onDraftElement],
  )

  // Delete/Backspace tar bort och Ctrl/Cmd+D duplicerar händelsen som har fokus (Tab eller ett klick som stängts).
  const handleKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (!(keyEvent.target instanceof HTMLElement)) return
      const element = keyEvent.target.closest<HTMLElement>('.fc-event')
      // Bara när själva händelsen har fokus, inte något inuti den.
      if (element !== keyEvent.target) return
      const calendarId = element.dataset[CALENDAR_ID_ATTRIBUTE]
      const eventId = element.dataset[EVENT_ID_ATTRIBUTE]
      if (calendarId === undefined || eventId === undefined) return
      const ref = { calendarId, eventId }

      if (keyEvent.key === 'Delete' || keyEvent.key === 'Backspace') {
        if (onEventDelete === undefined) return
        keyEvent.preventDefault()
        onEventDelete(ref)
      } else if (
        keyEvent.key.toLowerCase() === 'd' &&
        (keyEvent.ctrlKey || keyEvent.metaKey) &&
        !keyEvent.altKey &&
        !keyEvent.shiftKey
      ) {
        if (onEventDuplicate === undefined) return
        // Annars sparar webbläsaren sidan som bokmärke.
        keyEvent.preventDefault()
        onEventDuplicate(ref)
      }
    },
    [onEventDelete, onEventDuplicate],
  )

  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const props = eventPropsSchema.safeParse(arg.event.extendedProps)
      if (props.success) onEventClick?.(props.data)
    },
    [onEventClick],
  )

  // Flytta och ändra längd. Esc under dragningen kastar ändringen (se useDragCancel).
  const dragCancel = useDragCancel()
  const handleDragStart = useCallback(
    (arg: EventDragStartArg | EventResizeStartArg) => {
      dragCancel.begin(arg.jsEvent)
    },
    [dragCancel],
  )
  const handleDragStop = useCallback(() => {
    dragCancel.end()
  }, [dragCancel])
  const reportChange = useCallback(
    (kind: UpdateEventTimeRequest['kind'], arg: EventDropArg | EventResizeDoneArg) => {
      if (dragCancel.consumeCancel()) {
        arg.revert()
        return
      }
      const props = eventPropsSchema.safeParse(arg.event.extendedProps)
      const to = eventTimeFromMovedEvent(arg.event, getBrowserTimeZone())
      if (!props.success || to === null || !onEventTimeChange) {
        arg.revert()
        return
      }
      // Alt+dra duplicerar: originalet ligger kvar och kopian hamnar där man släppte.
      if (kind === 'move' && arg.jsEvent.altKey && onEventCopy) {
        arg.revert()
        onEventCopy(props.data, to)
        return
      }
      onEventTimeChange({ ...props.data, kind, to })
    },
    [dragCancel, onEventTimeChange, onEventCopy],
  )
  const handleEventDrop = useCallback(
    (arg: EventDropArg) => {
      reportChange('move', arg)
    },
    [reportChange],
  )
  const handleEventResize = useCallback(
    (arg: EventResizeDoneArg) => {
      reportChange('resize', arg)
    },
    [reportChange],
  )

  return (
    <div
      className="sc-calendar-grid"
      role="region"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
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
        editable={editableCalendarIds !== undefined && onEventTimeChange !== undefined}
        eventResizableFromStart
        // Slutet räknas alltid ut, även efter dragning mellan heldag och tid (standardlängd 1 h resp. 1 dag).
        forceEventDuration
        eventDragStart={handleDragStart}
        eventDragStop={handleDragStop}
        eventResizeStart={handleDragStart}
        eventResizeStop={handleDragStop}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        selectable={onSelectTime !== undefined}
        selectMinDistance={SELECT_MIN_DISTANCE_PX}
        snapDuration={SNAP_DURATION}
        select={handleSelect}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
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
