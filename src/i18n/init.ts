import { createInstance, type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import { FALLBACK_LOCALE, type Locale } from './locale'
import sv from './sv.json'

export const resources = {
  sv: { translation: sv },
  en: { translation: en },
} as const

/** Skapar en ny i18n-instans. Separat instans per anrop gör den enkel att använda i tester. */
export async function createI18n(locale: Locale): Promise<I18n> {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false }, // React escapar redan
    returnNull: false,
  })
  return instance
}
