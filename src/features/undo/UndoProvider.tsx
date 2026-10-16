import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useAuth } from '@/features/auth'
import { useGoogleAccess } from '@/features/google-access'
import { UndoManager, type UndoCommand } from '@/lib/undo'
import { UndoContext, type UndoContextValue } from './UndoContext'
import { UndoToaster } from './UndoToaster'

interface UndoProviderProps {
  children: ReactNode
  /** Byts ut i tester. */
  manager?: UndoManager
}

/**
 * Ger appen ångra-hanteraren (PROJECT.md §5.3) och visar toasts när något misslyckas eller ångras.
 * Måste ligga inom AuthProvider, GoogleAccessProvider och I18nextProvider.
 *
 * - Ett misslyckat anrop som beror på återkallad åtkomst skickar användaren till "Koppla om".
 * - Ångra-staplarna töms när användaren loggar ut eller byts, så att inget kan ångras åt fel konto.
 */
export function UndoProvider({ children, manager: provided }: UndoProviderProps) {
  const { state: auth } = useAuth()
  const { reportAccessError } = useGoogleAccess()
  const uid = auth.status === 'signedIn' ? auth.user.uid : null

  const [manager] = useState(() => provided ?? new UndoManager())
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot)

  useEffect(() => {
    return manager.onEvent((event) => {
      if (event.type === 'failed') reportAccessError(event.error)
    })
  }, [manager, reportAccessError])

  useEffect(() => {
    return () => {
      manager.clear()
    }
  }, [uid, manager])

  const execute = useCallback((command: UndoCommand) => manager.execute(command), [manager])
  const undo = useCallback(() => manager.undo(), [manager])
  const redo = useCallback(() => manager.redo(), [manager])

  const value = useMemo<UndoContextValue>(
    () => ({ execute, undo, redo, snapshot }),
    [execute, undo, redo, snapshot],
  )

  return (
    <UndoContext.Provider value={value}>
      {children}
      <UndoToaster manager={manager} />
    </UndoContext.Provider>
  )
}
