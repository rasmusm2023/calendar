import { z } from 'zod'

/**
 * Validering av klientens miljövariabler (VITE_*). Allt här är publikt och hamnar i webbläsaren,
 * så hemligheter får aldrig finnas här (GOOGLE_CLIENT_SECRET ligger som secret i Cloud Functions).
 */

/** Värdet som .env.example använder. Visar ett tydligt fel om någon glömt fylla i det. */
export const PLACEHOLDER = 'REPLACE_ME'

/** Funktionernas och Firestores region (södra Sverige: Frankfurt). Måste matcha functions/. */
export const DEFAULT_FUNCTIONS_REGION = 'europe-west3'

const required = z.string().trim().min(1)

const envSchema = z.object({
  VITE_FIREBASE_API_KEY: required,
  VITE_FIREBASE_AUTH_DOMAIN: required,
  VITE_FIREBASE_PROJECT_ID: required,
  VITE_FIREBASE_APP_ID: required,
  VITE_GOOGLE_CLIENT_ID: required,
  VITE_FIREBASE_FUNCTIONS_REGION: required.default(DEFAULT_FUNCTIONS_REGION),
  VITE_USE_EMULATORS: z.enum(['true', 'false']).default('false'),
})

export interface AppEnv {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    appId: string
  }
  /** OAuth-klientens ID (publikt). Secret finns bara i Cloud Functions. */
  googleClientId: string
  functionsRegion: string
  useEmulators: boolean
}

export class EnvError extends Error {
  override name = 'EnvError'
}

const SECRET_LIKE = /SECRET|PRIVATE_KEY|REFRESH|PASSWORD/i

/** Tolkar och validerar miljövariabler. Kastar EnvError med läsbart meddelande vid fel. */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const leaked = Object.keys(raw).filter((key) => key.startsWith('VITE_') && SECRET_LIKE.test(key))
  if (leaked.length > 0) {
    throw new EnvError(
      `Hemligheter får inte ligga i VITE_-variabler (de exponeras i webbläsaren): ${leaked.join(', ')}`,
    )
  }

  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new EnvError(
      `Ogiltig eller saknad miljökonfiguration. Kopiera .env.example till .env.local och fyll i värdena.\n${problems.join('\n')}`,
    )
  }

  const values = parsed.data
  const useEmulators = values.VITE_USE_EMULATORS === 'true'

  if (!useEmulators) {
    const unfilled = Object.entries(values)
      .filter(([, value]) => value === PLACEHOLDER)
      .map(([key]) => key)
    if (unfilled.length > 0) {
      throw new EnvError(`Fyll i riktiga värden i .env.local för: ${unfilled.join(', ')}`)
    }
  }

  return {
    firebase: {
      apiKey: values.VITE_FIREBASE_API_KEY,
      authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: values.VITE_FIREBASE_PROJECT_ID,
      appId: values.VITE_FIREBASE_APP_ID,
    },
    googleClientId: values.VITE_GOOGLE_CLIENT_ID,
    functionsRegion: values.VITE_FIREBASE_FUNCTIONS_REGION,
    useEmulators,
  }
}

let cached: AppEnv | undefined

/** Appens miljö från Vite (`import.meta.env`), validerad en gång. */
export function getEnv(): AppEnv {
  cached ??= parseEnv(import.meta.env)
  return cached
}
