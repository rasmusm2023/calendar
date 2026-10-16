import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoogleAccess } from '@/features/google-access'
import { useUndo } from '@/features/undo'
import type { EventTime } from '@/lib/google'
import { createEventCommand } from './createEventCommand'
import { createInputFromEvent } from './eventCopy'
import { findEventInCache } from './eventsCache'

/**
 * Duplicerar en händelse: kopian får samma uppgifter, i samma kalender, och syns direkt. Med `time` hamnar
 * kopian där (Alt+dra), annars på samma tid. En kopia av en instans av en återkommande händelse blir en
 * vanlig, enstaka händelse. Går att ångra. Finns originalet inte i cachen görs ingenting.
 */
export function useDuplicateEvent(
  timeZone: string,
): (ref: { calendarId: string; eventId: string }, time?: EventTime) => void {
  const { client } = useGoogleAccess()
  const queryClient = useQueryClient()
  const { execute } = useUndo()
  const { t } = useTranslation()

  return useCallback(
    (ref, time) => {
      const event = findEventInCache(queryClient, ref)
      if (event === undefined) return
      const title = event.title === '' ? t('event.untitled') : event.title
      void execute(
        createEventCommand(
          { client, queryClient, timeZone, label: t('event.duplicate.label', { title }) },
          createInputFromEvent(event, time),
        ),
      )
    },
    [client, queryClient, timeZone, execute, t],
  )
}
