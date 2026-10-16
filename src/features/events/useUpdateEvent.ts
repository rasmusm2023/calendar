import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import { editBefore, type EventEdit } from './eventEdit'
import { findEventInCache } from './eventsCache'
import { isSeriesScope, type RecurringScope } from './recurringScope'
import { updateEventCommand } from './updateEventCommand'
import { updateSeriesCommand } from './updateSeriesCommand'

export interface UpdateEventRequest {
  calendarId: string
  eventId: string
  /** Fälten som ändras, med de nya värdena. */
  edit: EventEdit
  /**
   * Vad ändringen gäller för en förekomst av en återkommande händelse. Utan den, eller med `this`, ändras bara
   * förekomsten.
   */
  scope?: RecurringScope
}

/**
 * Ändrar en händelse från redigeringspanelen: den ser ny ut direkt, skickas till Google i bakgrunden och
 * rullas tillbaka med en toast om det misslyckas. Går att ångra.
 *
 * Värdena före ändringen och titeln hämtas ur cachen när ändringen görs. Finns inte händelsen i cachen (den har
 * just tagits bort) görs ingenting.
 */
export function useUpdateEvent(timeZone: string): (request: UpdateEventRequest) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    ({ calendarId, eventId, edit, scope = 'this' }) => {
      const current = findEventInCache(queryClient, { calendarId, eventId })
      if (current === undefined) return
      const title = current.title === '' ? t('event.untitled') : current.title
      const label = t('event.edit.label', { title })
      const context = { client, queryClient, timeZone, label }
      if (isSeriesScope(scope) && current.recurringEventId !== undefined) {
        void execute(updateSeriesCommand(context, { instance: current, scope, edit }))
        return
      }
      void execute(
        updateEventCommand(context, {
          calendarId,
          eventId,
          from: editBefore(current, edit),
          to: edit,
        }),
      )
    },
    [client, queryClient, timeZone, execute, t],
  )
}
