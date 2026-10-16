import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type FunctionsErrorCode,
} from 'firebase-functions/v2/https'
import { ConfigError, findConfigProblem } from './config'
import { connectGoogle, getAccessToken } from './core'
import { createGoogleOAuthClient } from './oauth'
import { createFirestoreTokenStore } from './store'
import { GoogleAccessError, OAuthError, type Dependencies, type FailureReason } from './types'

const REGION = 'europe-west3'

const googleClientId = defineSecret('GOOGLE_CLIENT_ID')
const googleClientSecret = defineSecret('GOOGLE_CLIENT_SECRET')

const options: CallableOptions = {
  region: REGION,
  secrets: [googleClientId, googleClientSecret],
  // Håller kostnaden nere om något går fel.
  maxInstances: 5,
}

initializeApp()

function createDependencies(): Dependencies {
  // I emulatorn kan token-endpointen peka på en lokal låtsas-Google (används av E2E-tester).
  const tokenUrl =
    process.env.FUNCTIONS_EMULATOR === 'true' ? process.env.GOOGLE_OAUTH_TOKEN_URL : undefined

  const clientId = googleClientId.value()
  const clientSecret = googleClientSecret.value()
  // Fel i secrets ska ge ett tydligt fel i loggen i stället för ett obegripligt svar från Google.
  // Emulatorn och E2E använder låtsasvärden som inte följer Googles format.
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    const problem = findConfigProblem({ clientId, clientSecret })
    if (problem !== null) throw new ConfigError(problem)
  }

  return {
    store: createFirestoreTokenStore(getFirestore()),
    oauth: createGoogleOAuthClient({
      clientId,
      clientSecret,
      ...(tokenUrl !== undefined && tokenUrl !== '' ? { tokenUrl } : {}),
    }),
    now: () => Date.now(),
  }
}

const CODE_BY_REASON: Record<FailureReason, FunctionsErrorCode> = {
  invalid_request: 'invalid-argument',
  code_exchange_failed: 'failed-precondition',
  insufficient_scope: 'failed-precondition',
  no_refresh_token: 'failed-precondition',
  not_connected: 'failed-precondition',
  access_revoked: 'failed-precondition',
  google_unavailable: 'unavailable',
}

/** Klienten läser `error.details.reason` (se `FailureReason`). Inget annat läcker ut. */
function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error
  if (error instanceof GoogleAccessError) {
    return new HttpsError(CODE_BY_REASON[error.reason], error.reason, { reason: error.reason })
  }
  if (error instanceof ConfigError) {
    logger.error('Felaktigt konfigurerade secrets', { problem: error.problem })
    return new HttpsError('internal', 'internal')
  }
  if (error instanceof OAuthError) {
    // Googles felkod (t.ex. invalid_client) är en kort uppräkning utan känsliga uppgifter.
    logger.error('Google avvisade token-anropet', {
      kind: error.kind,
      googleError: error.googleError ?? 'unknown',
    })
    return new HttpsError('internal', 'internal')
  }
  // Logga bara typen, aldrig meddelandet, eftersom det i teorin kan innehålla känsliga uppgifter.
  logger.error('Oväntat fel i Google-funktion', {
    errorName: error instanceof Error ? error.name : typeof error,
  })
  return new HttpsError('internal', 'internal')
}

function requireUid(auth: { uid: string } | undefined): string {
  if (auth === undefined) {
    throw new HttpsError('unauthenticated', 'unauthenticated')
  }
  return auth.uid
}

export const googleConnect = onCall(options, async (request) => {
  const uid = requireUid(request.auth)
  try {
    return await connectGoogle(createDependencies(), uid, request.data)
  } catch (error) {
    throw toHttpsError(error)
  }
})

export const googleAccessToken = onCall(options, async (request) => {
  const uid = requireUid(request.auth)
  try {
    return await getAccessToken(createDependencies(), uid)
  } catch (error) {
    throw toHttpsError(error)
  }
})
