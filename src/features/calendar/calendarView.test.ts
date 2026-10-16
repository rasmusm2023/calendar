import { describe, expect, it } from 'vitest'
import { toRfc3339, type DateRange } from '@/lib/dates'
import {
  AGENDA_DAYS,
  DEFAULT_DAYS,
  DEFAULT_VIEW,
  clampDays,
  loadView,
  saveView,
  shiftAnchor,
  visibleRange,
  type CalendarView,
  type ViewStorage,
} from './calendarView'

const TZ = 'Europe/Stockholm'
// Onsdag 21 okt 2026.
const ANCHOR = new Date('2026-10-21T12:00:00Z')

const view = (kind: CalendarView['kind'], days = DEFAULT_DAYS): CalendarView => ({ kind, days })

function dates(range: DateRange): [string, string] {
  return [toRfc3339(range.start, TZ).slice(0, 10), toRfc3339(range.end, TZ).slice(0, 10)]
}

function day(date: Date): string {
  return toRfc3339(date, TZ).slice(0, 10)
}

describe('clampDays', () => {
  it.each([
    [1, 2],
    [2, 2],
    [7, 7],
    [14, 14],
    [15, 14],
    [3.4, 3],
    [Number.NaN, DEFAULT_DAYS],
    [Number.POSITIVE_INFINITY, DEFAULT_DAYS],
  ])('%s blir %s', (input, expected) => {
    expect(clampDays(input)).toBe(expected)
  })
})

describe('visibleRange', () => {
  it('dag: ett dygn', () => {
    expect(dates(visibleRange(view('day'), ANCHOR, TZ))).toEqual(['2026-10-21', '2026-10-22'])
  })

  it('vecka: måndag till måndag', () => {
    expect(dates(visibleRange(view('week'), ANCHOR, TZ))).toEqual(['2026-10-19', '2026-10-26'])
  })

  it('N dagar: från datumet, så många dygn som valts', () => {
    expect(dates(visibleRange(view('days', 5), ANCHOR, TZ))).toEqual(['2026-10-21', '2026-10-26'])
  })

  it('N dagar: håller sig inom 2 till 14', () => {
    expect(dates(visibleRange(view('days', 1), ANCHOR, TZ))[1]).toBe('2026-10-23')
    expect(dates(visibleRange(view('days', 40), ANCHOR, TZ))[1]).toBe('2026-11-04')
  })

  it('månad: hela veckor runt månaden', () => {
    expect(dates(visibleRange(view('month'), ANCHOR, TZ))).toEqual(['2026-09-28', '2026-11-02'])
  })

  it('schema: 30 dygn från datumet', () => {
    expect(dates(visibleRange(view('agenda'), ANCHOR, TZ))).toEqual(['2026-10-21', '2026-11-20'])
    expect(AGENDA_DAYS).toBe(30)
  })

  it('räknar dygnet i given tidszon', () => {
    // 23:30 UTC den 21 okt är 01:30 den 22 okt i Stockholm.
    const late = new Date('2026-10-21T23:30:00Z')
    expect(dates(visibleRange(view('day'), late, TZ))).toEqual(['2026-10-22', '2026-10-23'])
  })
})

describe('shiftAnchor', () => {
  it.each([
    ['day', 1, '2026-10-22'],
    ['day', -1, '2026-10-20'],
    ['week', 1, '2026-10-28'],
    ['week', -1, '2026-10-14'],
    ['month', 1, '2026-11-21'],
    ['month', -1, '2026-09-21'],
    ['agenda', 1, '2026-11-20'],
    ['agenda', -1, '2026-09-21'],
  ] as const)('%s, riktning %i ger %s', (kind, direction, expected) => {
    expect(day(shiftAnchor(view(kind), ANCHOR, direction, TZ))).toBe(expected)
  })

  it('N dagar: så många dagar som vyn visar', () => {
    expect(day(shiftAnchor(view('days', 5), ANCHOR, 1, TZ))).toBe('2026-10-26')
    expect(day(shiftAnchor(view('days', 5), ANCHOR, -1, TZ))).toBe('2026-10-16')
  })

  it('ger en vanlig Date', () => {
    expect(shiftAnchor(view('week'), ANCHOR, 1, TZ)).toBeInstanceOf(Date)
  })

  it('flyttar fram och tillbaka till samma dag i alla vyer utom månad vid månadsslut', () => {
    for (const kind of ['day', 'week', 'days', 'agenda'] as const) {
      const forward = shiftAnchor(view(kind), ANCHOR, 1, TZ)
      expect(day(shiftAnchor(view(kind), forward, -1, TZ))).toBe(day(ANCHOR))
    }
  })

  it('går över sommartidsbytet utan att hamna en dag fel', () => {
    // Sommartiden slutar natten till söndag 25 okt.
    const saturday = new Date('2026-10-24T12:00:00Z')
    expect(day(shiftAnchor(view('week'), saturday, 1, TZ))).toBe('2026-10-31')
    expect(day(shiftAnchor(view('day'), saturday, 1, TZ))).toBe('2026-10-25')
  })

  it('månad: kapar dagen i en kortare månad', () => {
    const jan31 = new Date('2026-01-31T12:00:00Z')
    expect(day(shiftAnchor(view('month'), jan31, 1, TZ))).toBe('2026-02-28')
  })
})

describe('sparad vy', () => {
  function memoryStorage(initial: Record<string, string> = {}): ViewStorage & {
    data: Record<string, string>
  } {
    const data = { ...initial }
    return {
      data,
      getItem: (key) => data[key] ?? null,
      setItem: (key, value) => {
        data[key] = value
      },
    }
  }

  it('ger veckan när inget är sparat eller lagring saknas', () => {
    expect(loadView(memoryStorage(), 'u1')).toEqual(DEFAULT_VIEW)
    expect(loadView(null, 'u1')).toEqual(DEFAULT_VIEW)
  })

  it('sparar och läser per användare', () => {
    const storage = memoryStorage()

    saveView(storage, 'u1', view('month'))
    saveView(storage, 'u2', view('days', 6))

    expect(loadView(storage, 'u1')).toEqual(view('month'))
    expect(loadView(storage, 'u2')).toEqual(view('days', 6))
    expect(loadView(storage, 'u3')).toEqual(DEFAULT_VIEW)
  })

  it.each(['inte json', '{"kind":"year","days":3}', '{"days":3}', '42', 'null'])(
    'faller tillbaka på veckan för trasig data (%s)',
    (raw) => {
      const storage = memoryStorage({ 'sc:calendarView:u1': raw })

      expect(loadView(storage, 'u1')).toEqual(DEFAULT_VIEW)
    },
  )

  it('rättar ett ogiltigt antal dagar men behåller vyn', () => {
    const storage = memoryStorage({ 'sc:calendarView:u1': '{"kind":"days","days":99}' })

    expect(loadView(storage, 'u1')).toEqual(view('days', DEFAULT_DAYS))
  })

  it('kraschar inte när lagringen kastar', () => {
    const broken: ViewStorage = {
      getItem: () => {
        throw new Error('blockerad')
      },
      setItem: () => {
        throw new Error('full')
      },
    }

    expect(loadView(broken, 'u1')).toEqual(DEFAULT_VIEW)
    expect(() => {
      saveView(broken, 'u1', view('day'))
    }).not.toThrow()
  })
})
