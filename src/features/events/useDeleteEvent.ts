import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import { deleteEventCommand } from './deleteEventCommand'
import { findEventInCache } from './eventsCache'

/**
 * Tar bort en händelse: den försvinner direkt, tas bort hos Google i bakgrunden och kommer tillbaka med en toast
 * om det misslyckas. Toasten efteråt erbjuder "Ångra". Finns händelsen inte i cachen (den är redan borta)
 * görs ingenting.
 */
export function useDeleteEvent(
  timeZone: string,
): (ref: { calendarId: string; eventId: string }) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    (ref) => {
      const event = findEventInCache(queryClient, ref)
      if (event === undefined) return
      const title = event.title === '' ? t('event.untitled') : event.title
      void execute(
        deleteEventCommand(
          { client, queryClient, timeZone, label: t('event.delete.label', { title }) },
          event,
        ),
      )
    },
    [client, queryClient, timeZone, execute, t],
  )
}
