const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'

export type ConfigProblem =
  | 'client_id_missing_suffix'
  | 'client_secret_looks_like_client_id'
  | 'client_secret_has_whitespace'
  | 'client_id_has_whitespace'

/**
 * Upptäcker de vanligaste misstagen när secrets sätts (t.ex. att Client ID hamnat i båda, eller att ett
 * kommando klistrats in som värde). Returnerar bara en kategori, aldrig själva värdena, så att det är
 * säkert att logga.
 */
export function findConfigProblem(config: {
  clientId: string
  clientSecret: string
}): ConfigProblem | null {
  if (/\s/.test(config.clientId)) return 'client_id_has_whitespace'
  if (!config.clientId.endsWith(CLIENT_ID_SUFFIX)) return 'client_id_missing_suffix'
  if (/\s/.test(config.clientSecret)) return 'client_secret_has_whitespace'
  if (config.clientSecret.endsWith(CLIENT_ID_SUFFIX)) return 'client_secret_looks_like_client_id'
  return null
}

/** Kastas när secrets är uppenbart fel. Meddelandet innehåller bara kategorin. */
export class ConfigError extends Error {
  readonly problem: ConfigProblem

  constructor(problem: ConfigProblem) {
    super(problem)
    this.name = 'ConfigError'
    this.problem = problem
  }
}
