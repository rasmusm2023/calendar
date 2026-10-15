import { FirebaseError } from 'firebase/app'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { SignInError, type AuthService, type AuthUser } from './types'

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  }
}

/** Översätter Firebase-fel vid popup-inloggning till appens egna feltyper. */
export function mapSignInError(error: unknown): SignInError {
  if (error instanceof SignInError) return error
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return new SignInError('cancelled', { cause: error })
      case 'auth/popup-blocked':
        return new SignInError('popupBlocked', { cause: error })
    }
  }
  return new SignInError('failed', { cause: error })
}

/**
 * Firebase Auth som AuthService. Sessionen sparas av Firebase (IndexedDB), så användaren förblir
 * inloggad efter omladdning. Det här är bara identiteten. Åtkomst till Google Calendar hanteras
 * separat via Googles kodflöde och Cloud Functions (PROJECT.md §3).
 */
export function createFirebaseAuthService(auth: Auth): AuthService {
  return {
    onAuthStateChanged(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user ? toAuthUser(user) : null)
      })
    },

    async signInWithGoogle() {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      try {
        await signInWithPopup(auth, provider)
      } catch (error) {
        throw mapSignInError(error)
      }
    },

    async signOut() {
      await signOut(auth)
    },
  }
}
