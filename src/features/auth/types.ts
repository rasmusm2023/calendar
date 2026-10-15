/** Den inloggade användaren, som appen ser den (inga Firebase-typer läcker ut ur auth-featuren). */
export interface AuthUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: AuthUser }

export type SignInErrorKind = 'cancelled' | 'popupBlocked' | 'failed'

export class SignInError extends Error {
  override name = 'SignInError'
  readonly kind: SignInErrorKind

  constructor(kind: SignInErrorKind, options?: ErrorOptions) {
    super(`Inloggning misslyckades: ${kind}`, options)
    this.kind = kind
  }
}

export type Unsubscribe = () => void

/**
 * Det auth-lagret behöver av en identitetsleverantör. Firebase-implementationen finns i
 * firebaseAuthService.ts. Gränssnittet gör provider och UI enkla att testa utan Firebase.
 */
export interface AuthService {
  /** Anropas direkt med nuvarande tillstånd (efter att sparad session lästs) och vid varje ändring. */
  onAuthStateChanged(listener: (user: AuthUser | null) => void): Unsubscribe
  /** Kastar SignInError. kind "cancelled" betyder att användaren stängde fönstret. */
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
}
