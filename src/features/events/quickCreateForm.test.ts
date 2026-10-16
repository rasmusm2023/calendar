import { describe, expect, it } from 'vitest'
import {
  changeStart,
  eventTimeFromForm,
  formFromEventTime,
  type FormTimes,
} from './quickCreateForm'

const TZ = 'Europe/Stockholm'

const TIMED: FormTimes = {
  allDay: false,
  startDate: '2026-10-21',
  startTime: '09:00',
  endDate: '2026-10-21',
  endTime: '10:30',
}

describe('formFromEventTime', () => {
  it('delar en tidsbestämd händelse i datum och klockslag i tidszonen', () => {
    expect(
      formFromEventTime(
        { start: '2026-10-21T09:00:00+02:00', end: '2026-10-21T10:30:00+02:00', allDay: false },
        TZ,
      ),
    ).toEqual(TIMED)
  })

  it('visar tiden i tidszonen även om Google gav en annan offset', () => {
    const form = formFromEventTime(
      { start: '2026-10-21T07:00:00Z', end: '2026-10-21T08:00:00Z', allDay: false },
      TZ,
    )
    expect(form).toMatchObject({ startTime: '09:00', endTime: '10:00' })
  })

  it('gör slutdatum inklusive för heldag och behåller standardtider för när heldag slås av', () => {
    expect(formFromEventTime({ start: '2026-10-21', end: '2026-10-24', allDay: true }, TZ)).toEqual(
      {
        allDay: true,
        startDate: '2026-10-21',
        startTime: '09:00',
        endDate: '2026-10-23',
        endTime: '10:00',
      },
    )
  })

  it('klarar en heldag där slutet inte ligger efter början', () => {
    const form = formFromEventTime({ start: '2026-10-21', end: '2026-10-21', allDay: true }, TZ)
    expect(form.endDate).toBe('2026-10-21')
  })
})

describe('eventTimeFromForm', () => {
  it('ger tid med offset för tidsbestämd händelse', () => {
    expect(eventTimeFromForm(TIMED, TZ)).toEqual({
      start: '2026-10-21T09:00:00+02:00',
      end: '2026-10-21T10:30:00+02:00',
      allDay: false,
    })
  })

  it('använder rätt offset efter sommartidens slut', () => {
    expect(
      eventTimeFromForm({ ...TIMED, startDate: '2026-11-02', endDate: '2026-11-02' }, TZ),
    ).toEqual({
      start: '2026-11-02T09:00:00+01:00',
      end: '2026-11-02T10:30:00+01:00',
      allDay: false,
    })
  })

  it('stöder händelser över midnatt', () => {
    expect(
      eventTimeFromForm(
        { ...TIMED, startTime: '23:00', endDate: '2026-10-22', endTime: '01:00' },
        TZ,
      ),
    ).toEqual({
      start: '2026-10-21T23:00:00+02:00',
      end: '2026-10-22T01:00:00+02:00',
      allDay: false,
    })
  })

  it('ger exklusivt slutdatum för heldag', () => {
    expect(eventTimeFromForm({ ...TIMED, allDay: true, endDate: '2026-10-23' }, TZ)).toEqual({
      start: '2026-10-21',
      end: '2026-10-24',
      allDay: true,
    })
    expect(eventTimeFromForm({ ...TIMED, allDay: true }, TZ)).toEqual({
      start: '2026-10-21',
      end: '2026-10-22',
      allDay: true,
    })
  })

  it('ger null när något saknas eller är ogiltigt', () => {
    expect(eventTimeFromForm({ ...TIMED, startDate: '' }, TZ)).toBeNull()
    expect(eventTimeFromForm({ ...TIMED, endDate: '2026-02-30' }, TZ)).toBeNull()
    expect(eventTimeFromForm({ ...TIMED, startTime: '' }, TZ)).toBeNull()
    expect(eventTimeFromForm({ ...TIMED, endTime: '25:00' }, TZ)).toBeNull()
  })

  it('ger null när slutet inte ligger efter början', () => {
    expect(eventTimeFromForm({ ...TIMED, endTime: '09:00' }, TZ)).toBeNull()
    expect(eventTimeFromForm({ ...TIMED, endTime: '08:00' }, TZ)).toBeNull()
    expect(eventTimeFromForm({ ...TIMED, allDay: true, endDate: '2026-10-20' }, TZ)).toBeNull()
  })

  it('ignorerar klockslagen för heldag, även om de är ogiltiga', () => {
    expect(
      eventTimeFromForm({ ...TIMED, allDay: true, startTime: '', endTime: '' }, TZ),
    ).not.toBeNull()
  })
})

describe('changeStart', () => {
  it('flyttar slutet lika mycket så att längden behålls', () => {
    expect(changeStart(TIMED, { startTime: '13:00' }, TZ)).toMatchObject({
      startTime: '13:00',
      endDate: '2026-10-21',
      endTime: '14:30',
    })
  })

  it('flyttar slutet över midnatt och till nästa datum', () => {
    expect(changeStart(TIMED, { startTime: '23:00' }, TZ)).toMatchObject({
      endDate: '2026-10-22',
      endTime: '00:30',
    })
    expect(changeStart(TIMED, { startDate: '2026-10-25' }, TZ)).toMatchObject({
      endDate: '2026-10-25',
      endTime: '10:30',
    })
  })

  it('behåller antalet dagar för heldag', () => {
    const allDay: FormTimes = { ...TIMED, allDay: true, endDate: '2026-10-23' }
    expect(changeStart(allDay, { startDate: '2026-11-01' }, TZ)).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    })
  })

  it('ändrar bara det som angavs när formuläret var ogiltigt innan', () => {
    const invalid = { ...TIMED, endTime: '08:00' }
    expect(changeStart(invalid, { startTime: '07:00' }, TZ)).toEqual({
      ...invalid,
      startTime: '07:00',
    })
  })

  it('ändrar bara det som angavs när nya starten är ofullständig', () => {
    expect(changeStart(TIMED, { startTime: '' }, TZ)).toEqual({ ...TIMED, startTime: '' })
    expect(changeStart(TIMED, { startDate: '2026-10-2' }, TZ)).toEqual({
      ...TIMED,
      startDate: '2026-10-2',
    })
  })

  it('räknar längden ur senaste giltiga tiden när formuläret är ofullständigt', () => {
    const lastValid = eventTimeFromForm(TIMED, TZ)
    const cleared = changeStart(TIMED, { startTime: '' }, TZ, lastValid)
    expect(cleared.startTime).toBe('')

    expect(changeStart(cleared, { startTime: '13:00' }, TZ, lastValid)).toMatchObject({
      startTime: '13:00',
      endTime: '14:30',
    })
  })

  it('räknar antalet dagar för heldag ur senaste giltiga tiden', () => {
    const allDay: FormTimes = { ...TIMED, allDay: true, endDate: '2026-10-23' }
    const lastValid = eventTimeFromForm(allDay, TZ)
    const cleared = changeStart(allDay, { startDate: '' }, TZ, lastValid)

    expect(changeStart(cleared, { startDate: '2026-11-01' }, TZ, lastValid)).toMatchObject({
      endDate: '2026-11-03',
    })
  })

  it('ignorerar senaste giltiga tiden om den var av annat slag än formuläret', () => {
    const timed = eventTimeFromForm(TIMED, TZ)
    const allDayBroken: FormTimes = { ...TIMED, allDay: true, endDate: '2026-10-01' }

    expect(changeStart(allDayBroken, { startDate: '2026-11-01' }, TZ, timed)).toEqual({
      ...allDayBroken,
      startDate: '2026-11-01',
    })
  })
})
