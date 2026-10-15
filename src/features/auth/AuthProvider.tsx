import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { SignInError, type AuthService, type AuthState } from './types'

interface AuthProviderProps {
  service: AuthService
  children: ReactNode
}

export function AuthProvider({ service, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [signInError, setSignInError] = useState<AuthContextValue['signInError']>(null)

  useEffect(() => {
    return service.onAuthStateChanged((user) => {
      setState(user ? { status: 'signedIn', user } : { status: 'signedOut' })
      if (user) setSignInError(null)
    })
  }, [service])

  const signIn = useCallback(async () => {
    setSignInError(null)
    try {
      await service.signInWithGoogle()
    } catch (error) {
      const kind = error instanceof SignInError ? error.kind : 'failed'
      // Användaren som stänger fönstret har valt att avbryta, och ska inte mötas av ett fel.
      if (kind !== 'cancelled') setSignInError(kind)
    }
  }, [service])

  const signOut = useCallback(async () => {
    await service.signOut()
  }, [service])

  const value = useMemo<AuthContextValue>(
    () => ({ state, signInError, signIn, signOut }),
    [state, signInError, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
