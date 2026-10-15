import { createI18n } from './init'
import { detectLocale, type Locale } from './locale'

export { createI18n, resources } from './init'
export { detectLocale, FALLBACK_LOCALE, SUPPORTED_LOCALES, type Locale } from './locale'

/** Initierar i18n för appen utifrån webbläsarens språk och håller <html lang> i synk. */
export async function setupAppI18n(
  preferredLanguages: readonly string[] = navigator.languages,
  root: HTMLElement = document.documentElement,
) {
  const locale: Locale = detectLocale(preferredLanguages)
  const instance = await createI18n(locale)
  root.lang = instance.language
  instance.on('languageChanged', (language) => {
    root.lang = language
  })
  return instance
}
