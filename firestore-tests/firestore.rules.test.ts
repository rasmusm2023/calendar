import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const OWNER = 'alice'
const OTHER = 'bob'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-spaces-calendar-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // Cloud Functions (Admin SDK) skriver refresh token. Reglerna gäller inte dem.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${OWNER}/private/google`), {
      refreshToken: 'SECRET-REFRESH-TOKEN',
      scope: 'https://www.googleapis.com/auth/calendar',
      connectedAt: 1,
    })
  })
})

const owner = () => testEnv.authenticatedContext(OWNER).firestore()
const other = () => testEnv.authenticatedContext(OTHER).firestore()
const anonymous = () => testEnv.unauthenticatedContext().firestore()

/** Appens metadata-samlingar under users/{uid}, enligt PROJECT.md §4.2. */
const ALLOWED_COLLECTIONS = ['settings', 'spaces', 'calendarPrefs', 'families', 'familyRules']

describe('private/google (refresh token)', () => {
  it('kan inte läsas av ägaren', async () => {
    await assertFails(getDoc(doc(owner(), `users/${OWNER}/private/google`)))
  })

  it('kan inte skrivas, skapas över eller raderas av ägaren', async () => {
    const ref = doc(owner(), `users/${OWNER}/private/google`)
    await assertFails(setDoc(ref, { refreshToken: 'stulen' }))
    await assertFails(setDoc(ref, { refreshToken: 'stulen' }, { merge: true }))
    await assertFails(deleteDoc(ref))
  })

  it('kan inte hittas genom att lista private-samlingen', async () => {
    await assertFails(getDocs(collection(owner(), `users/${OWNER}/private`)))
  })

  it('kan inte nås av andra användare eller oinloggade', async () => {
    const path = `users/${OWNER}/private/google`
    await assertFails(getDoc(doc(other(), path)))
    await assertFails(getDoc(doc(anonymous(), path)))
    await assertFails(setDoc(doc(other(), path), { refreshToken: 'x' }))
  })

  it('kan inte skapas av ägaren i andra dokument under private heller', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/private/annat`), { a: 1 }))
    await assertFails(getDoc(doc(owner(), `users/${OWNER}/private/annat`)))
  })

  it('har oförändrat innehåll efter alla nekade försök (Admin SDK ser det orört)', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/private/google`), { refreshToken: 'x' }))
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDoc(doc(context.firestore(), `users/${OWNER}/private/google`))
      expect(snapshot.data()).toMatchObject({ refreshToken: 'SECRET-REFRESH-TOKEN' })
    })
  })
})

describe.each(ALLOWED_COLLECTIONS)('users/{uid}/%s', (name) => {
  const path = (uid: string) => `users/${uid}/${name}/item1`

  it('ägaren kan skapa, läsa, uppdatera, lista och radera', async () => {
    const ref = doc(owner(), path(OWNER))
    await assertSucceeds(setDoc(ref, { value: 1 }))
    const snapshot = await assertSucceeds(getDoc(ref))
    expect(snapshot.data()).toEqual({ value: 1 })
    await assertSucceeds(setDoc(ref, { value: 2 }, { merge: true }))
    await assertSucceeds(getDocs(collection(owner(), `users/${OWNER}/${name}`)))
    await assertSucceeds(deleteDoc(ref))
  })

  it('en annan användare nekas läsning, skrivning och listning', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), path(OWNER)), { value: 1 })
    })
    await assertFails(getDoc(doc(other(), path(OWNER))))
    await assertFails(setDoc(doc(other(), path(OWNER)), { value: 99 }))
    await assertFails(deleteDoc(doc(other(), path(OWNER))))
    await assertFails(getDocs(collection(other(), `users/${OWNER}/${name}`)))
  })

  it('en oinloggad användare nekas allt', async () => {
    await assertFails(getDoc(doc(anonymous(), path(OWNER))))
    await assertFails(setDoc(doc(anonymous(), path(OWNER)), { value: 1 }))
  })

  it('ägaren kan inte skriva i någon annans dokument', async () => {
    await assertFails(setDoc(doc(owner(), path(OTHER)), { value: 1 }))
  })
})

describe('övriga sökvägar (allt som inte uttryckligen tillåts nekas)', () => {
  it('händelsedata får aldrig lagras i Firestore, inte ens av ägaren', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/events/e1`), { title: 'Möte' }))
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/calendars/c1/events/e1`), { a: 1 }))
    await assertFails(setDoc(doc(owner(), 'events/e1'), { title: 'Möte' }))
  })

  it('okända samlingar och toppnivådokument nekas', async () => {
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/okand/x`), { a: 1 }))
    await assertFails(getDoc(doc(owner(), 'users-public/x')))
    await assertFails(getDocs(collection(owner(), 'users')))
  })

  it('ägaren kan läsa och skriva sitt eget användardokument, andra nekas', async () => {
    await assertSucceeds(setDoc(doc(owner(), `users/${OWNER}`), { createdAt: 1 }))
    await assertSucceeds(getDoc(doc(owner(), `users/${OWNER}`)))
    await assertFails(getDoc(doc(other(), `users/${OWNER}`)))
  })

  it('en match på användardokumentet ger inte åtkomst till private-underdokument', async () => {
    await assertSucceeds(setDoc(doc(owner(), `users/${OWNER}`), { createdAt: 1 }))
    await assertFails(getDoc(doc(owner(), `users/${OWNER}/private/google`)))
  })
})

describe('kontroll: den ursprungliga regeln i PROJECT.md §4.3 är osäker', () => {
  const FLAWED_RULES = `
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /users/{uid}/{document=**} { allow read, write: if request.auth.uid == uid; }
        match /users/{uid}/private/{doc} { allow read, write: if false; }
      }
    }
  `

  it('låter ägaren läsa refresh token, eftersom överlappande regler kombineras med OR', async () => {
    const flawed = await initializeTestEnvironment({
      projectId: 'demo-spaces-calendar-flawed',
      firestore: { rules: FLAWED_RULES },
    })
    try {
      const path = `users/${OWNER}/private/google`
      await flawed.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), path), { refreshToken: 'SECRET-REFRESH-TOKEN' })
      })
      const snapshot = await assertSucceeds(
        getDoc(doc(flawed.authenticatedContext(OWNER).firestore(), path)),
      )
      expect(snapshot.data()).toMatchObject({ refreshToken: 'SECRET-REFRESH-TOKEN' })
    } finally {
      await flawed.cleanup()
    }
  })
})
