import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/features/auth'
import {
  GisError,
  GoogleAccessError,
  createGoogleClient,
  needsReconnect,
  type GoogleAccessReason,
} from '@/lib/google'
import { GoogleAccessContext, type GoogleAccessContextValue } from './GoogleAccessContext'
import type { ConnectFailureKey, GoogleAccessService, GoogleAccessState } from './types'

interface GoogleAccessProviderProps {
  service: GoogleAccessService
  children: ReactNode
}

interface Outcome {
  uid: string
  state: GoogleAccessState
}

function stateForReason(reason: GoogleAccessReason): GoogleAccessState {
  return needsReconnect(reason)
    ? { status: 'needsConnection', reason }
    : { status: 'error', reason }
}

function failureKeyFor(error: unknown): ConnectFailureKey | null {
  if (error instanceof GisError) {
    // Användaren som stänger fönstret har valt att avbryta, och ska inte mötas av ett fel.
    return error.kind === 'cancelled' ? null : error.kind
  }
  if (error instanceof GoogleAccessError) {
    switch (error.reason) {
      case 'insufficient_scope':
        return 'insufficientScope'
      case 'no_refresh_token':
        return 'noRefreshToken'
      case 'code_exchange_failed':
        return 'codeExchangeFailed'
      case 'google_unavailable':
        return 'unavailable'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * Håller reda på om den inloggade användaren har kopplat Google Calendar. Kontrollen görs en gång
 * per inloggad användare. Cachad token glöms vid utloggning och när användaren byts.
 */
export function GoogleAccessProvider({ service, children }: GoogleAccessProviderProps) {
  const { state: auth } = useAuth()
  const uid = auth.status === 'signedIn' ? auth.user.uid : null
  const email = auth.status === 'signedIn' ? auth.user.email : null

  // Resultatet hör till en användare. Visas bara om det gäller den som är inloggad nu.
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [connectFailure, setConnectFailure] = useState<ConnectFailureKey | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (uid === null) return

    let current = true
    service.getAccessToken().then(
      () => {
        if (current) setOutcome({ uid, state: { status: 'connected' } })
      },
      (error: unknown) => {
        if (!current) return
        const reason = error instanceof GoogleAccessError ? error.reason : 'unknown'
        setOutcome({ uid, state: stateForReason(reason) })
      },
    )

    return () => {
      current = false
      service.clear()
    }
  }, [uid, service, attempt])

  const state = useMemo<GoogleAccessState>(() => {
    if (uid === null) return { status: 'idle' }
    return outcome?.uid === uid ? outcome.state : { status: 'checking' }
  }, [uid, outcome])

  const connect = useCallback(async () => {
    if (uid === null) return
    setConnectFailure(null)
    try {
      await service.connect(email ?? undefined)
      setOutcome({ uid, state: { status: 'connected' } })
    } catch (error) {
      setConnectFailure(failureKeyFor(error))
    }
  }, [service, uid, email])

  const recheck = useCallback(() => {
    setOutcome(null)
    setConnectFailure(null)
    setAttempt((value) => value + 1)
  }, [])

  const getAccessToken = useCallback(() => service.getAccessToken(), [service])

  const invalidateToken = useCallback(() => {
    service.invalidateToken()
  }, [service])

  const client = useMemo(
    () => createGoogleClient({ getAccessToken, invalidateToken }),
    [getAccessToken, invalidateToken],
  )

  const reportAccessError = useCallback(
    (error: unknown) => {
      if (uid === null) return
      if (error instanceof GoogleAccessError && needsReconnect(error.reason)) {
        setOutcome({ uid, state: stateForReason(error.reason) })
      }
    },
    [uid],
  )

  const value = useMemo<GoogleAccessContextValue>(
    () => ({
      state,
      connectFailure,
      connect,
      recheck,
      getAccessToken,
      client,
      invalidateToken,
      reportAccessError,
    }),
    [
      state,
      connectFailure,
      connect,
      recheck,
      getAccessToken,
      client,
      invalidateToken,
      reportAccessError,
    ],
  )

  return <GoogleAccessContext.Provider value={value}>{children}</GoogleAccessContext.Provider>
}
