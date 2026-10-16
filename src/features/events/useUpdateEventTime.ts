import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import type { EventTime } from '@/lib/google'
import { findEventInCache } from './eventsCache'
import { updateEventTimeCommand } from './updateEventTimeCommand'

export interface UpdateEventTimeRequest {
  calendarId: string
  eventId: string
  /** Vad användaren gjorde: flyttade händelsen eller ändrade dess längd. */
  kind: 'move' | 'resize'
  /** Den nya tiden. */
  to: EventTime
}

/**
 * Flyttar eller ändrar längd på en händelse: den syns direkt på nya platsen, skickas till Google i
 * bakgrunden och rullas tillbaka med en toast om det misslyckas. Går att ångra.
 *
 * Tiden före ändringen och titeln hämtas ur cachen, så att flera snabba ändringar av samma händelse bygger
 * på varandra. Finns inte händelsen i cachen (den har just tagits bort) görs ingenting.
 */
export function useUpdateEventTime(timeZone: string): (request: UpdateEventTimeRequest) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    ({ calendarId, eventId, kind, to }) => {
      const current = findEventInCache(queryClient, { calendarId, eventId })
      if (current === undefined) return
      const title = current.title === '' ? t('event.untitled') : current.title
      const label = t(kind === 'move' ? 'event.move.label' : 'event.resize.label', { title })
      const from: EventTime = { start: current.start, end: current.end, allDay: current.allDay }
      void execute(
        updateEventTimeCommand(
          { client, queryClient, timeZone, label },
          { calendarId, eventId, from, to },
        ),
      )
    },
    [client, queryClient, timeZone, execute, t],
  )
}
