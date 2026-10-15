import { formatHex, parse, wcagContrast } from 'culori'

/** Lägsta kontrast för normal text enligt WCAG 2.x nivå AA. */
export const WCAG_AA_NORMAL_TEXT = 4.5

export const BLACK = '#000000'
export const WHITE = '#ffffff'

/** Tolkar en CSS-färg (hex, rgb(), oklch() …) till hex. Kastar för ogiltig färg. */
export function toHex(color: string): string {
  const parsed = parse(color)
  if (!parsed) {
    throw new Error(`Ogiltig färg: "${color}"`)
  }
  return formatHex(parsed)
}

/** WCAG-kontrastförhållande mellan två färger, från 1 (ingen kontrast) till 21 (svart mot vitt). */
export function contrastRatio(a: string, b: string): number {
  const first = parse(a)
  const second = parse(b)
  if (!first) throw new Error(`Ogiltig färg: "${a}"`)
  if (!second) throw new Error(`Ogiltig färg: "${b}"`)
  return wcagContrast(first, second)
}

/**
 * Textfärgen (svart eller vit) som ger bäst kontrast mot bakgrunden.
 * Den bästa av de två ger alltid minst ca 4,58:1, alltså WCAG AA för normal text, oavsett bakgrund.
 */
export function readableTextColor(background: string): typeof BLACK | typeof WHITE {
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE
}
