import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import { deleteEventCommand } from './deleteEventCommand'
import { deleteSeriesCommand } from './deleteSeriesCommand'
import { findEventInCache } from './eventsCache'
import { isSeriesScope, type RecurringScope } from './recurringScope'

/**
 * Tar bort en händelse: den försvinner direkt, tas bort hos Google i bakgrunden och kommer tillbaka med en toast
 * om det misslyckas. Toasten efteråt erbjuder "Ångra". Finns händelsen inte i cachen (den är redan borta)
 * görs ingenting.
 *
 * För en förekomst av en återkommande händelse anger `scope` om bara den, den och följande, eller hela serien tas
 * bort. Utan den tas bara förekomsten bort.
 */
export function useDeleteEvent(
  timeZone: string,
): (ref: { calendarId: string; eventId: string }, scope?: RecurringScope) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    (ref, scope = 'this') => {
      const event = findEventInCache(queryClient, ref)
      if (event === undefined) return
      const title = event.title === '' ? t('event.untitled') : event.title
      const context = {
        client,
        queryClient,
        timeZone,
        label: t('event.delete.label', { title }),
      }
      if (isSeriesScope(scope) && event.recurringEventId !== undefined) {
        void execute(deleteSeriesCommand(context, { instance: event, scope }))
        return
      }
      void execute(deleteEventCommand(context, event))
    },
    [client, queryClient, timeZone, execute, t],
  )
}
