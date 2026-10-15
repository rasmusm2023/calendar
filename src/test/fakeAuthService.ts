import { vi } from 'vitest'
import type { AuthService, AuthUser, SignInError } from '@/features/auth'

export const TEST_USER: AuthUser = {
  uid: 'user-1',
  displayName: 'Test Person',
  email: 'test@example.com',
  photoURL: null,
}

export type InitialAuth = AuthUser | null | 'pending'

/**
 * Fejkad AuthService för tester. `initial: 'pending'` betyder att sparad session ännu inte lästs
 * (ingen händelse skickas förrän `emit` anropas). Annars skickas tillståndet asynkront, som Firebase gör.
 */
export function createFakeAuthService(initial: InitialAuth = null) {
  let user: AuthUser | null = initial === 'pending' ? null : initial
  const listeners = new Set<(user: AuthUser | null) => void>()
  let nextSignInError: SignInError | Error | null = null

  const emit = (next: AuthUser | null) => {
    user = next
    listeners.forEach((listener) => {
      listener(next)
    })
  }

  const signInWithGoogle = vi.fn(async () => {
    await Promise.resolve()
    if (nextSignInError) {
      const error = nextSignInError
      nextSignInError = null
      throw error
    }
    emit(TEST_USER)
  })
  const signOut = vi.fn(async () => {
    await Promise.resolve()
    emit(null)
  })

  const service: AuthService = {
    onAuthStateChanged: (listener) => {
      listeners.add(listener)
      if (initial !== 'pending') {
        queueMicrotask(() => {
          if (listeners.has(listener)) listener(user)
        })
      }
      return () => {
        listeners.delete(listener)
      }
    },
    signInWithGoogle: () => signInWithGoogle(),
    signOut: () => signOut(),
  }

  return {
    service,
    /** Spioner för att kontrollera anrop utan att lösgöra metoder från service-objektet. */
    spies: { signInWithGoogle, signOut },
    emit,
    failNextSignIn(error: SignInError | Error) {
      nextSignInError = error
    },
    listenerCount: () => listeners.size,
  }
}
