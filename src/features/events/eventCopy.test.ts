import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@/types'
import { createInputFromEvent } from './eventCopy'

const EVENT: CalEvent = {
  id: 'e1',
  calendarId: 'cal',
  etag: '"1"',
  title: 'Gympass',
  start: '2026-10-21T17:00:00+02:00',
  end: '2026-10-21T18:00:00+02:00',
  allDay: false,
  location: 'Gymmet',
  description: 'Ta med handduk',
  reminders: { useDefault: true },
  familyId: 'fam-1',
  important: true,
  recurringEventId: 'series',
}

describe('createInputFromEvent', () => {
  it('kopierar innehållet men inte id, etag eller återkomst', () => {
    expect(createInputFromEvent(EVENT)).toEqual({
      calendarId: 'cal',
      title: 'Gympass',
      start: EVENT.start,
      end: EVENT.end,
      allDay: false,
      location: 'Gymmet',
      description: 'Ta med handduk',
      reminders: { useDefault: true },
      familyId: 'fam-1',
      important: true,
    })
  })

  it('byter tid när en ny tid anges, även mellan heldag och tidsbestämd', () => {
    const copy = createInputFromEvent(EVENT, {
      start: '2026-10-22',
      end: '2026-10-23',
      allDay: true,
    })

    expect(copy).toMatchObject({ start: '2026-10-22', end: '2026-10-23', allDay: true })
  })

  it('utelämnar fält som saknas', () => {
    const copy = createInputFromEvent({
      id: 'e2',
      calendarId: 'cal',
      etag: '"1"',
      title: '',
      start: EVENT.start,
      end: EVENT.end,
      allDay: false,
      important: false,
    })

    expect(Object.keys(copy).toSorted()).toEqual(
      ['allDay', 'calendarId', 'end', 'important', 'start', 'title'].toSorted(),
    )
  })
})
