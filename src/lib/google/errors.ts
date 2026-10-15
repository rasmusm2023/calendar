/**
 * Orsaker när vi inte kan få åtkomst till Google Calendar. De första sju kommer från Cloud Functions
 * (`error.details.reason`, se functions/src/types.ts). `unauthenticated` och `unknown` hittas på klienten.
 */
export const GOOGLE_ACCESS_REASONS = [
  'invalid_request',
  'code_exchange_failed',
  'insufficient_scope',
  'no_refresh_token',
  'not_connected',
  'access_revoked',
  'google_unavailable',
  'unauthenticated',
  'unknown',
] as const

export type GoogleAccessReason = (typeof GOOGLE_ACCESS_REASONS)[number]

export class GoogleAccessError extends Error {
  override name = 'GoogleAccessError'
  readonly reason: GoogleAccessReason

  constructor(reason: GoogleAccessReason) {
    super(reason)
    this.reason = reason
  }
}

/** Orsaker som löses av att användaren kopplar (om) Google Calendar. */
export type ReconnectReason = 'not_connected' | 'access_revoked'

export function needsReconnect(reason: GoogleAccessReason): reason is ReconnectReason {
  return reason === 'not_connected' || reason === 'access_revoked'
}

/**
 * Fel från själva Google Calendar API:
 * - `rateLimited`: för många anrop, även efter nya försök med väntetid.
 * - `quotaExceeded`: dygnskvoten är slut. Det hjälper inte att försöka igen.
 * - `forbidden`: Google nekar just den här åtgärden (annan sak än återkallad åtkomst).
 * - `notFound` och `gone`: kalendern eller händelsen finns inte längre.
 * - `badRequest`: vi skickade något Google inte accepterar. Det är ett fel hos oss.
 * - `server`: Googles servrar svarar med fel, även efter nya försök.
 * - `network`: ingen kontakt med Google, även efter nya försök.
 * - `badResponse`: svaret har fel form.
 * Återkallad åtkomst (401 som består) kastas i stället som `GoogleAccessError`.
 */
export type GoogleApiErrorKind =
  | 'rateLimited'
  | 'quotaExceeded'
  | 'forbidden'
  | 'notFound'
  | 'gone'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'badResponse'

export class GoogleApiError extends Error {
  override name = 'GoogleApiError'
  readonly kind: GoogleApiErrorKind
  readonly status: number | undefined

  constructor(kind: GoogleApiErrorKind, status?: number) {
    super(status === undefined ? kind : `${kind} (${String(status)})`)
    this.kind = kind
    this.status = status
  }
}

export type GisErrorKind = 'cancelled' | 'popupBlocked' | 'loadFailed' | 'failed'

/** Fel i Googles inloggningsbibliotek (Google Identity Services). */
export class GisError extends Error {
  override name = 'GisError'
  readonly kind: GisErrorKind

  constructor(kind: GisErrorKind) {
    super(kind)
    this.kind = kind
  }
}
