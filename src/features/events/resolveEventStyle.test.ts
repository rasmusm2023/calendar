import { describe, expect, it } from 'vitest'
import { BLACK, WCAG_AA_NORMAL_TEXT, WHITE, contrastRatio } from '@/lib/color'
import type { CalEvent } from '@/types'
import { FALLBACK_EVENT_COLOR, resolveEventStyle } from './index'

function makeEvent(overrides: Partial<CalEvent> = {}): CalEvent {
  return {
    id: 'e1',
    calendarId: 'work',
    etag: '"1"',
    title: 'Möte',
    start: '2026-10-19T09:00:00+02:00',
    end: '2026-10-19T10:00:00+02:00',
    allDay: false,
    important: false,
    ...overrides,
  }
}

const ctx = {
  calendarColors: new Map([
    ['work', '#1a237e'],
    ['personal', '#ffeb3b'],
  ]),
}

describe('resolveEventStyle', () => {
  it('använder kalenderns färg som bakgrund och kant', () => {
    const style = resolveEventStyle(makeEvent({ calendarId: 'work' }), ctx)
    expect(style.bg).toBe('#1a237e')
    expect(style.border).toBe('#1a237e')
    expect(style.style).toBe('filled')
  })

  it('väljer vit text på mörk och svart text på ljus bakgrund', () => {
    expect(resolveEventStyle(makeEvent({ calendarId: 'work' }), ctx).text).toBe(WHITE)
    expect(resolveEventStyle(makeEvent({ calendarId: 'personal' }), ctx).text).toBe(BLACK)
  })

  it('ger alltid WCAG AA-kontrast mellan text och bakgrund', () => {
    for (const calendarId of ['work', 'personal', 'unknown']) {
      const style = resolveEventStyle(makeEvent({ calendarId }), ctx)
      expect(contrastRatio(style.text, style.bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
    }
  })

  it('faller tillbaka på neutral färg när kalendern är okänd', () => {
    const style = resolveEventStyle(makeEvent({ calendarId: 'unknown' }), ctx)
    expect(style.bg).toBe(FALLBACK_EVENT_COLOR)
  })

  it('för vidare important-flaggan men låter den inte påverka färgen', () => {
    const normal = resolveEventStyle(makeEvent({ important: false }), ctx)
    const important = resolveEventStyle(makeEvent({ important: true }), ctx)
    expect(normal.important).toBe(false)
    expect(important.important).toBe(true)
    expect(important.bg).toBe(normal.bg)
  })

  it('ändrar bara resultatet när kalenderfärgen ändras, inte händelsen', () => {
    const event = makeEvent()
    const before = resolveEventStyle(event, ctx)
    const after = resolveEventStyle(event, { calendarColors: new Map([['work', '#ffffff']]) })
    expect(before.bg).not.toBe(after.bg)
    expect(event).toEqual(makeEvent()) // händelsen är orörd, färgen lagras inte på den
  })
})
