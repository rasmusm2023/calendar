import { deleteApp, getApps } from 'firebase/app'
import { afterEach, describe, expect, it } from 'vitest'
import { getFirebase, parseEnv, resetFirebaseForTests } from './index'

const demoEnv = parseEnv({
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_PROJECT_ID: 'demo-spaces-calendar',
  VITE_FIREBASE_APP_ID: 'demo-app-id',
  VITE_GOOGLE_CLIENT_ID: 'demo.apps.googleusercontent.com',
  VITE_USE_EMULATORS: 'true',
})

afterEach(async () => {
  resetFirebaseForTests()
  await Promise.all(getApps().map((app) => deleteApp(app)))
})

describe('getFirebase', () => {
  it('initierar alla tjänster mot rätt projekt och region', () => {
    const { app, auth, db, functions } = getFirebase(demoEnv)
    expect(app.options.projectId).toBe('demo-spaces-calendar')
    expect(auth.app).toBe(app)
    expect(db.app).toBe(app)
    expect(functions.region).toBe('europe-west3')
  })

  it('pekar Auth mot emulatorn när VITE_USE_EMULATORS är på', () => {
    const { auth } = getFirebase(demoEnv)
    expect(auth.emulatorConfig).toMatchObject({ host: '127.0.0.1', port: 9099 })
  })

  it('återanvänder samma instans vid upprepade anrop', () => {
    expect(getFirebase(demoEnv)).toBe(getFirebase(demoEnv))
    expect(getApps()).toHaveLength(1)
  })
})
