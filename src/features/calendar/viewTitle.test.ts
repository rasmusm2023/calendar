import { describe, expect, it } from 'vitest'
import { visibleRange, type CalendarView } from './calendarView'
import { formatViewTitle, viewWeekNumber } from './viewTitle'

const TZ = 'Europe/Stockholm'
const ANCHOR = new Date('2026-10-21T12:00:00Z')

const view = (kind: CalendarView['kind'], days = 3): CalendarView => ({ kind, days })

/** Intl använder tunna och hårda mellanslag. Normalisera så att testerna blir läsbara. */
function normalize(text: string): string {
  return text.replace(/[\u00a0\u2009\u202f]/g, ' ')
}

function title(kind: CalendarView['kind'], locale: string, days = 3, anchor = ANCHOR) {
  const v = view(kind, days)
  return normalize(
    formatViewTitle({
      view: v,
      range: visibleRange(v, anchor, TZ),
      anchor,
      timeZone: TZ,
      locale,
    }),
  )
}

describe('formatViewTitle', () => {
  it('dag: veckodag och fullt datum', () => {
    expect(title('day', 'sv')).toBe('onsdag 21 oktober 2026')
    expect(title('day', 'en')).toBe('Wednesday, October 21, 2026')
  })

  it('vecka: datumspannet', () => {
    expect(title('week', 'sv')).toMatch(/^19.25 okt\. 2026$/)
    expect(title('week', 'en')).toMatch(/^Oct 19 . 25, 2026$/)
  })

  it('N dagar: från första till sista dagen', () => {
    expect(title('days', 'sv', 5)).toMatch(/^21.25 okt\. 2026$/)
  })

  it('N dagar över månadsskifte visar båda månaderna', () => {
    expect(title('days', 'sv', 5, new Date('2026-10-29T12:00:00Z'))).toMatch(
      /^29 okt\..*2 nov\. 2026$/,
    )
  })

  it('månad: månadens namn och år, inte det synliga rutnätets spann', () => {
    expect(title('month', 'sv')).toBe('oktober 2026')
    expect(title('month', 'en')).toBe('October 2026')
  })

  it('schema: datumspannet över 30 dygn (21 okt till och med 19 nov)', () => {
    expect(title('agenda', 'sv')).toMatch(/^21 okt\..*19 nov\. 2026$/)
  })

  it('använder användarens tidszon för dagen', () => {
    // 23:30 UTC den 21 okt är redan den 22 okt i Stockholm.
    expect(title('day', 'sv', 3, new Date('2026-10-21T23:30:00Z'))).toBe('torsdag 22 oktober 2026')
  })
})

describe('viewWeekNumber', () => {
  it.each([
    ['week', 43],
    ['day', 43],
    ['days', null],
    ['month', null],
    ['agenda', null],
  ] as const)('%s ger %s', (kind, expected) => {
    const v = view(kind)

    expect(viewWeekNumber(v, visibleRange(v, ANCHOR, TZ))).toBe(expected)
  })
})
