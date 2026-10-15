import { describe, expect, it } from 'vitest'
import { DEFAULT_FUNCTIONS_REGION, EnvError, PLACEHOLDER, parseEnv } from './index'

const valid = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'proj.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'proj',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_GOOGLE_CLIENT_ID: '123.apps.googleusercontent.com',
}

describe('parseEnv', () => {
  it('tolkar giltig konfiguration och sätter standardvärden', () => {
    expect(parseEnv(valid)).toEqual({
      firebase: {
        apiKey: 'key',
        authDomain: 'proj.firebaseapp.com',
        projectId: 'proj',
        appId: '1:123:web:abc',
      },
      googleClientId: '123.apps.googleusercontent.com',
      functionsRegion: DEFAULT_FUNCTIONS_REGION,
      useEmulators: false,
    })
  })

  it('tolkar VITE_USE_EMULATORS och egen region', () => {
    const env = parseEnv({
      ...valid,
      VITE_USE_EMULATORS: 'true',
      VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
    })
    expect(env.useEmulators).toBe(true)
    expect(env.functionsRegion).toBe('europe-west1')
  })

  it('kastar ett läsbart fel som nämner saknade variabler', () => {
    const missing = { ...valid, VITE_FIREBASE_API_KEY: undefined }
    expect(() => parseEnv(missing)).toThrow(EnvError)
    expect(() => parseEnv(missing)).toThrow(/VITE_FIREBASE_API_KEY/)
    expect(() => parseEnv(missing)).toThrow(/\.env\.example/)
  })

  it('avvisar tomma värden och ogiltigt VITE_USE_EMULATORS', () => {
    expect(() => parseEnv({ ...valid, VITE_FIREBASE_PROJECT_ID: '   ' })).toThrow(EnvError)
    expect(() => parseEnv({ ...valid, VITE_USE_EMULATORS: 'yes' })).toThrow(EnvError)
  })

  it('avvisar kvarlämnade platshållare från .env.example (utom mot emulatorer)', () => {
    const withPlaceholder = { ...valid, VITE_GOOGLE_CLIENT_ID: PLACEHOLDER }
    expect(() => parseEnv(withPlaceholder)).toThrow(/VITE_GOOGLE_CLIENT_ID/)
    expect(() => parseEnv({ ...withPlaceholder, VITE_USE_EMULATORS: 'true' })).not.toThrow()
  })

  it('vägrar starta om en hemlighet ligger i en VITE_-variabel', () => {
    expect(() => parseEnv({ ...valid, VITE_GOOGLE_CLIENT_SECRET: 'oops' })).toThrow(
      /VITE_GOOGLE_CLIENT_SECRET/,
    )
    expect(() => parseEnv({ ...valid, VITE_REFRESH_TOKEN: 'oops' })).toThrow(EnvError)
  })

  it('ignorerar variabler som inte börjar med VITE_', () => {
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_SECRET: 'x', MODE: 'test' })).not.toThrow()
  })
})
