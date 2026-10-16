import dayGridPlugin from '@fullcalendar/daygrid'
import FullCalendar from '@fullcalendar/react'
import svLocale from '@fullcalendar/core/locales/sv'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useEffect, useMemo, useRef } from 'react'
import type { StyleContext } from '@/features/events'
import type { CalEvent } from '@/types'
import { toFullCalendarEvents } from './mapEvents'
import './weekCalendar.css'

const PLUGINS = [timeGridPlugin, dayGridPlugin]
const LOCALES = [svLocale]
const CLOCK_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false } as const
const DAY_HEADER_FORMAT = { weekday: 'short', day: 'numeric', month: 'numeric' } as const
const MONDAY = 1

export interface WeekCalendarProps {
  events: readonly CalEvent[]
  /** Ger händelsernas färger. Bör vara memoiserad, annars byggs alla händelser om vid varje rendering. */
  styleContext: StyleContext
  /** Ett ögonblick i den vecka som ska visas. Veckan börjar på måndag. */
  date: Date
  /** 'sv' eller 'en'. */
  locale: string
  /** Tillgängligt namn för kalenderområdet. */
  ariaLabel: string
}

/**
 * Skrivskyddad veckovy (Fas 0). Det enda stället som känner till FullCalendar (PROJECT.md 2).
 * Resten av appen ger oss CalEvent och datum och får inget FullCalendar-specifikt tillbaka.
 *
 * Tider visas i webbläsarens tidszon (`timeZone: 'local'`). FullCalendar kan inte räkna med namngivna
 * tidszoner utan extra plugin, och i Fas 0 är användarens zon alltid webbläsarens.
 */
export function WeekCalendar({ events, styleContext, date, locale, ariaLabel }: WeekCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const calendarEvents = useMemo(
    () => toFullCalendarEvents(events, styleContext),
    [events, styleContext],
  )

  // Datumet styr vyn. Används tiden som beroende så att en ny Date med samma värde inte flyttar vyn.
  const time = date.getTime()
  useEffect(() => {
    calendarRef.current?.getApi().gotoDate(new Date(time))
  }, [time])

  return (
    <div className="sc-week-calendar" role="region" aria-label={ariaLabel}>
      <FullCalendar
        ref={calendarRef}
        plugins={PLUGINS}
        locales={LOCALES}
        locale={locale}
        initialView="timeGridWeek"
        initialDate={date}
        headerToolbar={false}
        firstDay={MONDAY}
        weekNumberCalculation="ISO"
        timeZone="local"
        events={calendarEvents}
        editable={false}
        selectable={false}
        eventInteractive
        nowIndicator
        allDaySlot
        height="100%"
        expandRows
        scrollTime="07:00:00"
        scrollTimeReset={false}
        slotLabelFormat={CLOCK_FORMAT}
        eventTimeFormat={CLOCK_FORMAT}
        dayHeaderFormat={DAY_HEADER_FORMAT}
      />
    </div>
  )
}
