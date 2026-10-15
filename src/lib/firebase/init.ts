import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { getEnv, type AppEnv } from './env'

export const EMULATOR_HOST = '127.0.0.1'
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, functions: 5001 } as const

export interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
}

let cached: FirebaseServices | undefined

/**
 * Initierar Firebase en gång (och återanvänder instansen vid HMR). Med `useEmulators` pekas
 * Auth, Firestore och Functions mot lokala emulatorer i stället för det riktiga projektet.
 */
export function getFirebase(env: AppEnv = getEnv()): FirebaseServices {
  if (cached) return cached

  const app = getApps().length > 0 ? getApp() : initializeApp(env.firebase)
  const auth = getAuth(app)
  const db = getFirestore(app)
  const functions = getFunctions(app, env.functionsRegion)

  if (env.useEmulators) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${String(EMULATOR_PORTS.auth)}`, {
      disableWarnings: true,
    })
    connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore)
    connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions)
  }

  cached = { app, auth, db, functions }
  return cached
}

/** Bara för tester: glöm den cachade instansen. */
export function resetFirebaseForTests(): void {
  cached = undefined
}
