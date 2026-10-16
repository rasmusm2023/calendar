import { describe, expect, it } from 'vitest'
import { eventTimeFromClick, eventTimeFromSelection } from './selection'

const TZ = 'Europe/Stockholm'

describe('eventTimeFromSelection', () => {
  it('ger tider med offset för en tidsbestämd dragning', () => {
    expect(
      eventTimeFromSelection(
        {
          start: new Date('2026-10-21T07:00:00Z'),
          end: new Date('2026-10-21T08:15:00Z'),
          allDay: false,
          startStr: '2026-10-21T09:00:00+02:00',
          endStr: '2026-10-21T10:15:00+02:00',
        },
        TZ,
      ),
    ).toEqual({
      start: '2026-10-21T09:00:00+02:00',
      end: '2026-10-21T10:15:00+02:00',
      allDay: false,
    })
  })

  it('använder tidszonen och inte webbläsarens offset i strängen', () => {
    const time = eventTimeFromSelection(
      {
        start: new Date('2026-11-02T08:00:00Z'),
        end: new Date('2026-11-02T09:00:00Z'),
        allDay: false,
        startStr: 'ignorerad',
        endStr: 'ignorerad',
      },
      TZ,
    )
    expect(time.start).toBe('2026-11-02T09:00:00+01:00')
  })

  it('ger rena datum med exklusivt slut för en heldagsdragning', () => {
    expect(
      eventTimeFromSelection(
        {
          start: new Date('2026-10-20T22:00:00Z'),
          end: new Date('2026-10-23T22:00:00Z'),
          allDay: true,
          startStr: '2026-10-21',
          endStr: '2026-10-24',
        },
        TZ,
      ),
    ).toEqual({ start: '2026-10-21', end: '2026-10-24', allDay: true })
  })

  it('klarar att heldagssträngar har med ett klockslag', () => {
    expect(
      eventTimeFromSelection(
        {
          start: new Date(),
          end: new Date(),
          allDay: true,
          startStr: '2026-10-21T00:00:00',
          endStr: '2026-10-22T00:00:00',
        },
        TZ,
      ),
    ).toEqual({ start: '2026-10-21', end: '2026-10-22', allDay: true })
  })
})

describe('eventTimeFromClick', () => {
  it('ger en timme för ett klick på en tid', () => {
    expect(
      eventTimeFromClick(
        {
          date: new Date('2026-10-21T07:30:00Z'),
          allDay: false,
          dateStr: '2026-10-21T09:30:00+02:00',
        },
        TZ,
      ),
    ).toEqual({
      start: '2026-10-21T09:30:00+02:00',
      end: '2026-10-21T10:30:00+02:00',
      allDay: false,
    })
  })

  it('ger en dag för ett klick på en dag, även över månadsskifte', () => {
    expect(
      eventTimeFromClick({ date: new Date(), allDay: true, dateStr: '2026-10-31' }, TZ),
    ).toEqual({ start: '2026-10-31', end: '2026-11-01', allDay: true })
  })

  it('ger en timme över midnatt för ett klick sent på kvällen', () => {
    expect(
      eventTimeFromClick(
        { date: new Date('2026-10-21T21:30:00Z'), allDay: false, dateStr: 'x' },
        TZ,
      ),
    ).toEqual({
      start: '2026-10-21T23:30:00+02:00',
      end: '2026-10-22T00:30:00+02:00',
      allDay: false,
    })
  })
})
