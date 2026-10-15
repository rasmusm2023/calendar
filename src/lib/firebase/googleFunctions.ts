import { FirebaseError } from 'firebase/app'
import { httpsCallable, type Functions } from 'firebase/functions'
import { z } from 'zod'
import { GOOGLE_ACCESS_REASONS, GoogleAccessError, type AccessToken } from '@/lib/google'

/**
 * Klient för Cloud Functions `googleConnect` och `googleAccessToken` (functions/src/index.ts).
 * Svaren valideras eftersom de kommer över nätverket.
 */

const accessTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().positive(),
})

const connectSchema = accessTokenSchema.extend({
  scope: z.string(),
})

const detailsSchema = z.object({ reason: z.enum(GOOGLE_ACCESS_REASONS) })

export type ConnectResult = z.infer<typeof connectSchema>

export interface GoogleFunctionsClient {
  /** Byter engångskoden mot tokens på servern. Ger första access token tillbaka. */
  connect(code: string): Promise<ConnectResult>
  /** Ber servern förnya access token med den sparade refresh token. */
  fetchAccessToken(): Promise<AccessToken>
}

/** Det som behövs för att anropa funktionerna. Gör att logiken kan testas utan Firebase. */
export interface CallableTransport {
  call(name: 'googleConnect' | 'googleAccessToken', data: unknown): Promise<unknown>
}

export function createFirebaseTransport(functions: Functions): CallableTransport {
  return {
    async call(name, data) {
      const result = await httpsCallable(functions, name)(data)
      return result.data
    },
  }
}

/** Översätter fel från ett callable-anrop till `GoogleAccessError`. */
export function mapCallableError(error: unknown): GoogleAccessError {
  if (error instanceof GoogleAccessError) return error

  if (error instanceof FirebaseError) {
    const details = detailsSchema.safeParse((error as { details?: unknown }).details)
    if (details.success) return new GoogleAccessError(details.data.reason)

    switch (error.code) {
      case 'functions/unauthenticated':
        return new GoogleAccessError('unauthenticated')
      case 'functions/unavailable':
      case 'functions/deadline-exceeded':
        return new GoogleAccessError('google_unavailable')
    }
  }

  return new GoogleAccessError('unknown')
}

export function createGoogleFunctionsClient(transport: CallableTransport): GoogleFunctionsClient {
  async function call<T>(
    name: 'googleConnect' | 'googleAccessToken',
    data: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let raw: unknown
    try {
      raw = await transport.call(name, data)
    } catch (error) {
      throw mapCallableError(error)
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new GoogleAccessError('unknown')
    return parsed.data
  }

  return {
    connect: (code) => call('googleConnect', { code }, connectSchema),
    fetchAccessToken: () => call('googleAccessToken', {}, accessTokenSchema),
  }
}
