import { describe, expect, it } from 'vitest'
import en from './en.json'
import { createI18n, detectLocale, setupAppI18n } from './index'
import sv from './sv.json'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('översättningsfiler', () => {
  it('sv.json och en.json har exakt samma nycklar', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(sv).sort())
  })

  it('inga översättningar är tomma', () => {
    for (const [name, file] of [
      ['sv', sv],
      ['en', en],
    ] as const) {
      const empty = flattenKeys(file).filter((key) => {
        const value = key.split('.').reduce<unknown>((node, part) => {
          return typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined
        }, file)
        return typeof value !== 'string' || value.trim() === ''
      })
      expect(empty, `tomma nycklar i ${name}.json`).toEqual([])
    }
  })
})

describe('detectLocale', () => {
  it('väljer första stödda språket i prioritetsordning', () => {
    expect(detectLocale(['de-DE', 'sv-SE', 'en-US'])).toBe('sv')
    expect(detectLocale(['en-GB', 'sv'])).toBe('en')
  })

  it('är skiftlägesokänslig och hanterar regionskoder', () => {
    expect(detectLocale(['SV-se'])).toBe('sv')
  })

  it('faller tillbaka på engelska när inget stöds eller listan är tom', () => {
    expect(detectLocale(['de', 'fr'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
})

describe('i18n-instans', () => {
  it('översätter på valt språk', async () => {
    const sv = await createI18n('sv')
    const en = await createI18n('en')
    expect(sv.t('common.retry')).toBe('Försök igen')
    expect(en.t('common.retry')).toBe('Try again')
  })

  it('sätter <html lang> och uppdaterar vid språkbyte', async () => {
    const root = document.createElement('html')
    const instance = await setupAppI18n(['sv-SE'], root)
    expect(root.lang).toBe('sv')
    await instance.changeLanguage('en')
    expect(root.lang).toBe('en')
  })
})
