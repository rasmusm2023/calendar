import { describe, expect, it } from 'vitest'
import { BLACK, WCAG_AA_NORMAL_TEXT, WHITE, contrastRatio, readableTextColor, toHex } from './index'

describe('contrastRatio', () => {
  it('ger 21 för svart mot vitt och 1 för samma färg', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('är symmetrisk', () => {
    expect(contrastRatio('#336699', '#ffcc00')).toBeCloseTo(contrastRatio('#ffcc00', '#336699'), 10)
  })

  it('kastar för ogiltig färg', () => {
    expect(() => contrastRatio('inte-en-färg', WHITE)).toThrow(/Ogiltig färg/)
    expect(() => contrastRatio(WHITE, 'nope')).toThrow(/Ogiltig färg/)
  })
})

describe('readableTextColor', () => {
  it('väljer svart på ljusa och vitt på mörka bakgrunder', () => {
    expect(readableTextColor('#ffffff')).toBe(BLACK)
    expect(readableTextColor('#ffeb3b')).toBe(BLACK) // gul
    expect(readableTextColor('#000000')).toBe(WHITE)
    expect(readableTextColor('#1a237e')).toBe(WHITE) // mörkblå
  })

  it('hanterar olika färgformat', () => {
    expect(readableTextColor('#fff')).toBe(BLACK)
    expect(readableTextColor('rgb(0, 0, 0)')).toBe(WHITE)
    expect(readableTextColor('oklch(0.95 0.05 100)')).toBe(BLACK)
  })

  it('kastar för ogiltig färg', () => {
    expect(() => readableTextColor('xyz')).toThrow(/Ogiltig färg/)
  })

  it('klarar WCAG AA för normal text på hela RGB-rymden (rutnät om 17 steg)', () => {
    let worst = Infinity
    let worstColor = ''
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const background = `rgb(${String(r)}, ${String(g)}, ${String(b)})`
          const ratio = contrastRatio(readableTextColor(background), background)
          if (ratio < worst) {
            worst = ratio
            worstColor = background
          }
        }
      }
    }
    expect(worst, `sämsta bakgrund: ${worstColor}`).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
  })

  it('klarar AA för Googles kalenderfärger (standardpalett)', () => {
    const palette = [
      '#ac725e',
      '#d06b64',
      '#f83a22',
      '#fa573c',
      '#ff7537',
      '#ffad46',
      '#42d692',
      '#16a765',
      '#7bd148',
      '#b3dc6c',
      '#fbe983',
      '#fad165',
      '#92e1c0',
      '#9fe1e7',
      '#9fc6e7',
      '#4986e7',
      '#9a9cff',
      '#b99aff',
      '#c2c2c2',
      '#cabdbf',
      '#cca6ac',
      '#f691b2',
      '#cd74e6',
      '#a47ae2',
    ]
    for (const background of palette) {
      expect(contrastRatio(readableTextColor(background), background)).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      )
    }
  })
})

describe('toHex', () => {
  it('normaliserar till sexsiffrig hex med gemener', () => {
    expect(toHex('#FFF')).toBe('#ffffff')
    expect(toHex('rgb(255, 0, 0)')).toBe('#ff0000')
  })

  it('kastar för ogiltig färg', () => {
    expect(() => toHex('#12')).toThrow(/Ogiltig färg/)
  })
})
