import { createContext, useContext } from 'react'
import type { AuthState, SignInErrorKind } from './types'

export interface AuthContextValue {
  state: AuthState
  /** Senaste inloggningsfelet som ska visas för användaren. Avbruten inloggning räknas inte. */
  signInError: Exclude<SignInErrorKind, 'cancelled'> | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth måste användas inom <AuthProvider>')
  }
  return value
}
