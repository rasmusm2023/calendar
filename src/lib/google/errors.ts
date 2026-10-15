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
