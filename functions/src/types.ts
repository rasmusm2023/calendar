/** Scope som appen ber om (PROJECT.md §3). */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

/**
 * Felkoder som klienten får i `error.details.reason`. Klienten visar "Koppla om Google Calendar"
 * för `not_connected` och `access_revoked`, och ett försök-igen-fel för `google_unavailable`.
 */
export type FailureReason =
  | 'invalid_request'
  | 'code_exchange_failed'
  | 'insufficient_scope'
  | 'no_refresh_token'
  | 'not_connected'
  | 'access_revoked'
  | 'google_unavailable'

/** Fel som funktionerna kastar med flit. Allt annat betraktas som internt fel. */
export class GoogleAccessError extends Error {
  readonly reason: FailureReason

  constructor(reason: FailureReason) {
    super(reason)
    this.name = 'GoogleAccessError'
    this.reason = reason
  }
}

/** Refresh token och metadata, lagrat i `users/{uid}/private/google`. */
export interface StoredGoogleToken {
  readonly refreshToken: string
  readonly scope: string
  /** Millisekunder sedan epoch. */
  readonly connectedAt: number
}

export interface TokenStore {
  get(uid: string): Promise<StoredGoogleToken | null>
  save(uid: string, token: StoredGoogleToken): Promise<void>
  delete(uid: string): Promise<void>
}

export interface CodeExchangeResult {
  readonly accessToken: string
  readonly expiresInSeconds: number
  /** Saknas om Google inte skickar en ny (t.ex. när användaren redan godkänt appen). */
  readonly refreshToken: string | undefined
  /** Mellanslagsseparerad lista med godkända scopes. */
  readonly scope: string
}

export interface RefreshResult {
  readonly accessToken: string
  readonly expiresInSeconds: number
}

/**
 * Orsaker när Google inte ger oss en token:
 * - `invalid_grant`: koden eller refresh token är ogiltig, utgången eller återkallad.
 * - `unavailable`: nätverksfel, timeout, 429 eller 5xx. Värt att försöka igen.
 * - `rejected`: Google nekar av ett annat skäl, t.ex. fel client secret. Det är vårt eget konfigurationsfel.
 */
export type OAuthFailureKind = 'invalid_grant' | 'unavailable' | 'rejected'

export class OAuthError extends Error {
  readonly kind: OAuthFailureKind

  constructor(kind: OAuthFailureKind) {
    super(kind)
    this.name = 'OAuthError'
    this.kind = kind
  }
}

export interface OAuthClient {
  /** Byter en engångskod från Google Identity Services mot tokens. Kastar `OAuthError`. */
  exchangeCode(code: string): Promise<CodeExchangeResult>
  /** Hämtar en ny access token. Kastar `OAuthError`. */
  refreshAccessToken(refreshToken: string): Promise<RefreshResult>
}

export interface Dependencies {
  readonly store: TokenStore
  readonly oauth: OAuthClient
  readonly now: () => number
}

/** Svar till klienten. Refresh token lämnar aldrig servern. */
export interface AccessTokenResponse {
  readonly accessToken: string
  /** Millisekunder sedan epoch när access token slutar gälla. */
  readonly expiresAt: number
}

export interface ConnectResponse extends AccessTokenResponse {
  readonly scope: string
}
