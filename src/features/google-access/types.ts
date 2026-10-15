import type { GoogleAccessReason, ReconnectReason } from '@/lib/google'

export type GoogleAccessState =
  /** Ingen är inloggad, så det finns inget att kontrollera. */
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'connected' }
  | { status: 'needsConnection'; reason: ReconnectReason }
  /** Det gick inte att ta reda på läget, t.ex. på grund av nätverksfel. Går att försöka igen. */
  | { status: 'error'; reason: GoogleAccessReason }

/** Nyckel för felmeddelandet vid misslyckad koppling (`googleAccess.error.<nyckel>`). */
export type ConnectFailureKey =
  | 'popupBlocked'
  | 'loadFailed'
  | 'failed'
  | 'insufficientScope'
  | 'noRefreshToken'
  | 'codeExchangeFailed'
  | 'unavailable'
  | 'unknown'

/** Åtkomsten till Google Calendar, sedd från appen. */
export interface GoogleAccessService {
  /** Ger en giltig access token för API-anrop mot Google (hämtas och förnyas vid behov). */
  getAccessToken(): Promise<string>
  /** Öppnar Googles samtyckesfönster och kopplar kalendern. Kastar `GisError` eller `GoogleAccessError`. */
  connect(loginHint?: string): Promise<void>
  /** Glöm den cachade token, t.ex. efter ett 401-svar från Google. */
  invalidateToken(): void
  /** Glöm allt i minnet. Anropas vid utloggning och byte av användare. */
  clear(): void
}
