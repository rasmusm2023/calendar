import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import { createEventCommand, type CreateEventInput } from './createEventCommand'

/**
 * Skapar en händelse: den syns direkt, skickas till Google i bakgrunden och rullas tillbaka med en toast
 * om det misslyckas. Går att ångra. Felhantering och toasts sköts av `UndoProvider`.
 */
export function useCreateEvent(timeZone: string): (input: CreateEventInput) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    (input) => {
      const title = input.title === '' ? t('event.untitled') : input.title
      void execute(
        createEventCommand(
          { client, queryClient, timeZone, label: t('event.create.label', { title }) },
          input,
        ),
      )
    },
    [client, queryClient, timeZone, execute, t],
  )
}
