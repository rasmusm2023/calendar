import { describe, expect, it } from 'vitest'
import { dayDelta, editForOccurrence, startMs, timeOnDay, toInstant } from './seriesTime'

const TZ = 'Europe/Stockholm'

describe('dayDelta', () => {
  it('räknar kalenderdagar mellan två tider, oavsett klockslag', () => {
    expect(dayDelta('2026-10-26T09:00:00+01:00', '2026-10-27T08:00:00+01:00')).toBe(1)
    expect(dayDelta('2026-10-26T23:30:00+01:00', '2026-10-24T00:30:00+02:00')).toBe(-2)
    expect(dayDelta('2026-10-26', '2026-10-26')).toBe(0)
  })

  it('räknar mellan heldag och tidsbestämd', () => {
    expect(dayDelta('2026-10-26', '2026-10-28T09:00:00+01:00')).toBe(2)
  })
})

describe('toInstant', () => {
  it('låter tidpunkter vara, och gör datum till midnatt i zonen', () => {
    expect(toInstant('2026-10-26T09:00:00+01:00', TZ)).toBe('2026-10-26T09:00:00+01:00')
    expect(toInstant('2026-10-26', TZ)).toBe('2026-10-26T00:00:00+01:00')
  })
})

describe('startMs', () => {
  it('jämför tider med olika offset som ögonblick', () => {
    expect(startMs('2026-10-26T09:00:00+02:00')).toBeLessThan(startMs('2026-10-26T08:30:00+01:00'))
  })
})

describe('timeOnDay', () => {
  const after = {
    start: '2026-10-21T10:30:00+02:00',
    end: '2026-10-21T11:30:00+02:00',
    allDay: false,
  }

  it('lägger klockslag och längd på förekomstens egen dag', () => {
    expect(timeOnDay('2026-10-14T09:00:00+02:00', 0, after, TZ)).toEqual({
      start: '2026-10-14T10:30:00+02:00',
      end: '2026-10-14T11:30:00+02:00',
      allDay: false,
    })
  })

  it('flyttar dagen och räknar offset för den nya dagen (sommartid slutar 25 okt)', () => {
    expect(timeOnDay('2026-10-21T09:00:00+02:00', 7, after, TZ)).toEqual({
      start: '2026-10-28T10:30:00+01:00',
      end: '2026-10-28T11:30:00+01:00',
      allDay: false,
    })
  })

  it('behåller en händelse som går över midnatt', () => {
    const overnight = {
      start: '2026-10-21T22:00:00+02:00',
      end: '2026-10-22T01:00:00+02:00',
      allDay: false,
    }
    expect(timeOnDay('2026-10-14T09:00:00+02:00', 0, overnight, TZ)).toEqual({
      start: '2026-10-14T22:00:00+02:00',
      end: '2026-10-15T01:00:00+02:00',
      allDay: false,
    })
  })

  it('ger heldagstid som datum med samma antal dagar', () => {
    const allDay = { start: '2026-10-21', end: '2026-10-23', allDay: true }
    expect(timeOnDay('2026-10-14', -1, allDay, TZ)).toEqual({
      start: '2026-10-13',
      end: '2026-10-15',
      allDay: true,
    })
  })

  it('kan göra en heldagsförekomst tidsbestämd', () => {
    expect(timeOnDay('2026-10-14', 0, after, TZ)).toEqual({
      start: '2026-10-14T10:30:00+02:00',
      end: '2026-10-14T11:30:00+02:00',
      allDay: false,
    })
  })
})

describe('editForOccurrence', () => {
  it('lämnar en ändring utan tid orörd', () => {
    const edit = { title: 'Nytt' }
    expect(editForOccurrence('2026-10-14T09:00:00+02:00', edit, 3, TZ)).toBe(edit)
  })

  it('behåller övriga fält och flyttar tiden till förekomstens dag', () => {
    const edit = {
      title: 'Nytt',
      time: { start: '2026-10-21T10:00:00+02:00', end: '2026-10-21T11:00:00+02:00', allDay: false },
    }
    expect(editForOccurrence('2026-10-14T09:00:00+02:00', edit, 1, TZ)).toEqual({
      title: 'Nytt',
      time: { start: '2026-10-15T10:00:00+02:00', end: '2026-10-15T11:00:00+02:00', allDay: false },
    })
  })
})
