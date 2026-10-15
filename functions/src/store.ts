import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { z } from 'zod'
import type { StoredGoogleToken, TokenStore } from './types'

const storedSchema = z.object({
  refreshToken: z.string().min(1),
  scope: z.string(),
  connectedAt: z.instanceof(Timestamp),
})

/**
 * Lagrar refresh token i `users/{uid}/private/google`. Dokumentet har ingen match i Firestore-reglerna,
 * så klienter når det aldrig. Admin SDK går förbi reglerna (PROJECT.md §4.3).
 */
export function createFirestoreTokenStore(db: Firestore): TokenStore {
  const ref = (uid: string) => db.doc(`users/${uid}/private/google`)

  return {
    async get(uid): Promise<StoredGoogleToken | null> {
      const snapshot = await ref(uid).get()
      if (!snapshot.exists) return null

      const parsed = storedSchema.safeParse(snapshot.data())
      // Ett skadat dokument behandlas som "inte kopplad" så att användaren kan koppla om.
      if (!parsed.success) return null

      return {
        refreshToken: parsed.data.refreshToken,
        scope: parsed.data.scope,
        connectedAt: parsed.data.connectedAt.toMillis(),
      }
    },

    async save(uid, token): Promise<void> {
      await ref(uid).set({
        refreshToken: token.refreshToken,
        scope: token.scope,
        connectedAt: Timestamp.fromMillis(token.connectedAt),
      })
    },

    async delete(uid): Promise<void> {
      await ref(uid).delete()
    },
  }
}
