/** Access token och när den slutar gälla (millisekunder sedan epoch). */
export interface AccessToken {
  accessToken: string
  expiresAt: number
}

/** Hämtar en ny access token, i praktiken Cloud Function `googleAccessToken`. */
export interface TokenSource {
  fetchAccessToken(): Promise<AccessToken>
}

/** Förnya ungefär så här lång tid innan access token går ut (PROJECT.md §3). */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface TokenManager {
  /** Ger en giltig access token. Förnyar vid behov, och samtidiga anrop delar på ett enda nätverksanrop. */
  getAccessToken(): Promise<string>
  /** Använd en token vi redan fått, t.ex. direkt efter att Google kopplats. */
  setToken(token: AccessToken): void
  /** Glöm den cachade token (t.ex. efter 401) så att nästa anrop hämtar en ny. */
  invalidate(): void
  /** Glöm allt, även pågående hämtningar. Anropas vid utloggning. */
  clear(): void
}

export interface TokenManagerOptions {
  source: TokenSource
  now?: () => number
}

/**
 * Håller access token enbart i minnet (aldrig localStorage eller liknande). Refresh token finns bara
 * på servern.
 */
export function createTokenManager({
  source,
  now = () => Date.now(),
}: TokenManagerOptions): TokenManager {
  let current: AccessToken | undefined
  let inFlight: Promise<string> | undefined
  // Ökas vid `clear` så att en hämtning som startade före utloggning inte fyller cachen igen.
  let generation = 0

  const isFresh = (token: AccessToken) => token.expiresAt - now() > REFRESH_MARGIN_MS

  const refresh = (): Promise<string> => {
    const startedIn = generation
    const request = source
      .fetchAccessToken()
      .then((token) => {
        if (startedIn === generation) current = token
        return token.accessToken
      })
      .finally(() => {
        if (inFlight === request) inFlight = undefined
      })
    inFlight = request
    return request
  }

  return {
    getAccessToken() {
      if (current && isFresh(current)) return Promise.resolve(current.accessToken)
      return inFlight ?? refresh()
    },

    setToken(token) {
      current = token
    },

    invalidate() {
      current = undefined
    },

    clear() {
      generation += 1
      current = undefined
      inFlight = undefined
    },
  }
}
