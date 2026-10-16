import { createContext, useContext } from 'react'
import type { GoogleClient } from '@/lib/google'
import type { ConnectFailureKey, GoogleAccessState } from './types'

export interface GoogleAccessContextValue {
  state: GoogleAccessState
  /** Felet från senaste försöket att koppla Google Calendar. Avbruten koppling räknas inte som fel. */
  connectFailure: ConnectFailureKey | null
  /** Öppnar Googles samtyckesfönster. */
  connect: () => Promise<void>
  /** Kontrollerar åtkomsten igen, t.ex. efter ett nätverksfel. */
  recheck: () => void
  /** Ger en giltig access token för anrop mot Google. */
  getAccessToken: () => Promise<string>
  /** Klient för Google Calendar API. Använder access token härifrån och förnyar den vid 401. */
  client: GoogleClient
  /** Glöm cachad token, t.ex. efter ett 401-svar från Google. */
  invalidateToken: () => void
  /**
   * Rapportera ett fel från ett Google-anrop. Återkallad åtkomst skickar användaren till
   * "Koppla om". Andra fel ignoreras här och hanteras där anropet gjordes.
   */
  reportAccessError: (error: unknown) => void
}

export const GoogleAccessContext = createContext<GoogleAccessContextValue | null>(null)

export function useGoogleAccess(): GoogleAccessContextValue {
  const value = useContext(GoogleAccessContext)
  if (!value) throw new Error('useGoogleAccess måste användas inom GoogleAccessProvider')
  return value
}
