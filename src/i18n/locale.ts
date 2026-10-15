export const SUPPORTED_LOCALES = ['sv', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const FALLBACK_LOCALE: Locale = 'en'

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Väljer språk utifrån webbläsarens önskade språk i prioritetsordning (t.ex. navigator.languages).
 * Första språket som vi stöder (på basspråksnivå, "sv-SE" -> "sv") vinner.
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (base !== undefined && isLocale(base)) {
      return base
    }
  }
  return FALLBACK_LOCALE
}
