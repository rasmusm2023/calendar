import { describe, expect, it } from 'vitest'
import type { CalendarAccessRole, CalendarInfo } from '@/types'
import { isWritableCalendar, pickDefaultCalendarId } from './writableCalendars'

function calendar(
  id: string,
  accessRole: CalendarAccessRole = 'owner',
  primary = false,
): CalendarInfo {
  return { id, name: id, backgroundColor: '#000000', selected: true, primary, accessRole }
}

describe('isWritableCalendar', () => {
  it('godtar ägare och skrivare, men inte läsare', () => {
    expect(isWritableCalendar({ accessRole: 'owner' })).toBe(true)
    expect(isWritableCalendar({ accessRole: 'writer' })).toBe(true)
    expect(isWritableCalendar({ accessRole: 'reader' })).toBe(false)
    expect(isWritableCalendar({ accessRole: 'freeBusyReader' })).toBe(false)
  })
})

describe('pickDefaultCalendarId', () => {
  it('väljer huvudkalendern om den är synlig', () => {
    const calendars = [calendar('a'), calendar('main', 'owner', true)]
    expect(pickDefaultCalendarId(calendars, new Set(['a', 'main']))).toBe('main')
  })

  it('väljer första synliga skrivbara kalendern när huvudkalendern är dold', () => {
    const calendars = [calendar('main', 'owner', true), calendar('a'), calendar('b')]
    expect(pickDefaultCalendarId(calendars, new Set(['b', 'a']))).toBe('a')
  })

  it('hoppar över kalendrar man inte får skriva i', () => {
    const calendars = [calendar('holidays', 'reader'), calendar('b', 'writer')]
    expect(pickDefaultCalendarId(calendars, new Set(['holidays', 'b']))).toBe('b')
  })

  it('faller tillbaka på dolda kalendrar när ingen synlig går att skriva i', () => {
    const calendars = [
      calendar('holidays', 'reader'),
      calendar('a'),
      calendar('main', 'owner', true),
    ]
    expect(pickDefaultCalendarId(calendars, new Set(['holidays']))).toBe('main')
    expect(pickDefaultCalendarId([calendar('holidays', 'reader'), calendar('a')], new Set())).toBe(
      'a',
    )
  })

  it('ger undefined när man inte får skriva i någon kalender', () => {
    expect(pickDefaultCalendarId([calendar('x', 'reader')], new Set(['x']))).toBeUndefined()
    expect(pickDefaultCalendarId([], new Set())).toBeUndefined()
  })
})
