import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@/types'
import {
  applyEdit,
  changesForGoogle,
  editBefore,
  isTimeOnly,
  matchesEdit,
  remindersOf,
  sameReminders,
} from './eventEdit'

const EVENT: CalEvent = {
  id: 'ev',
  calendarId: 'cal',
  etag: '"1"',
  title: 'Gympass',
  start: '2026-10-21T09:00:00+02:00',
  end: '2026-10-21T10:00:00+02:00',
  allDay: false,
  location: 'Gymmet',
  description: 'Ben',
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
  important: false,
}

describe('applyEdit', () => {
  it('ändrar bara de angivna fälten', () => {
    const next = applyEdit(EVENT, { title: 'Löpning' })

    expect(next).toEqual({ ...EVENT, title: 'Löpning' })
    expect(EVENT.title).toBe('Gympass')
  })

  it('ändrar tid och heldag tillsammans', () => {
    const next = applyEdit(EVENT, {
      time: { start: '2026-10-22', end: '2026-10-23', allDay: true },
    })

    expect(next).toMatchObject({ start: '2026-10-22', end: '2026-10-23', allDay: true })
  })

  it('tar bort plats och beskrivning när texten är tom', () => {
    const next = applyEdit(EVENT, { location: '', description: '' })

    expect(next).not.toHaveProperty('location')
    expect(next).not.toHaveProperty('description')
  })

  it('byter påminnelser', () => {
    expect(applyEdit(EVENT, { reminders: { useDefault: true } }).reminders).toEqual({
      useDefault: true,
    })
  })
})

describe('editBefore', () => {
  it('ger nuvarande värden för bara de fält som ändras', () => {
    expect(
      editBefore(EVENT, { title: 'x', location: 'y', reminders: { useDefault: true } }),
    ).toEqual({
      title: 'Gympass',
      location: 'Gymmet',
      reminders: EVENT.reminders,
    })
  })

  it('ger tom text för plats och beskrivning som saknas, och standard för påminnelser som saknas', () => {
    const bare: CalEvent = {
      id: 'ev',
      calendarId: 'cal',
      etag: '"1"',
      title: '',
      start: '2026-10-21',
      end: '2026-10-22',
      allDay: true,
      important: false,
    }

    expect(
      editBefore(bare, { location: 'x', description: 'x', reminders: { useDefault: true } }),
    ).toEqual({
      location: '',
      description: '',
      reminders: { useDefault: true },
    })
  })

  it('ger tiden som den är', () => {
    expect(editBefore(EVENT, { time: { start: 'a', end: 'b', allDay: false } }).time).toEqual({
      start: EVENT.start,
      end: EVENT.end,
      allDay: false,
    })
  })
})

describe('matchesEdit', () => {
  it('är sant när alla angivna fält redan stämmer, och falskt om något avviker', () => {
    expect(matchesEdit(EVENT, { title: 'Gympass', location: 'Gymmet' })).toBe(true)
    expect(matchesEdit(EVENT, { title: 'Gympass', location: 'Annat' })).toBe(false)
    expect(matchesEdit(EVENT, { description: 'Arm' })).toBe(false)
    expect(
      matchesEdit(EVENT, { time: { start: EVENT.start, end: EVENT.end, allDay: false } }),
    ).toBe(true)
    expect(
      matchesEdit(EVENT, { time: { start: EVENT.start, end: EVENT.start, allDay: false } }),
    ).toBe(false)
  })

  it('räknar saknad plats som tom text', () => {
    const noLocation: CalEvent = { ...EVENT }
    delete noLocation.location
    expect(matchesEdit(noLocation, { location: '' })).toBe(true)
  })

  it('jämför påminnelser med innehåll', () => {
    expect(
      matchesEdit(EVENT, {
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      }),
    ).toBe(true)
    expect(matchesEdit(EVENT, { reminders: { useDefault: true } })).toBe(false)
  })
})

describe('sameReminders', () => {
  it('bryr sig inte om ordningen', () => {
    expect(
      sameReminders(
        {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 10 },
            { method: 'email', minutes: 60 },
          ],
        },
        {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 10 },
          ],
        },
      ),
    ).toBe(true)
  })

  it('skiljer standard från egna, även en tom lista', () => {
    expect(sameReminders({ useDefault: true }, { useDefault: false, overrides: [] })).toBe(false)
    expect(sameReminders({ useDefault: true }, { useDefault: true })).toBe(true)
  })

  it('skiljer på metod och minuter', () => {
    const popup10 = { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] } as const
    expect(
      sameReminders(popup10, { useDefault: false, overrides: [{ method: 'email', minutes: 10 }] }),
    ).toBe(false)
    expect(
      sameReminders(popup10, { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] }),
    ).toBe(false)
  })
})

describe('remindersOf', () => {
  it('ger kalenderns standard när händelsen saknar påminnelser', () => {
    const bare: CalEvent = { ...EVENT }
    delete bare.reminders
    expect(remindersOf(bare)).toEqual({ useDefault: true })
    expect(remindersOf(EVENT)).toBe(EVENT.reminders)
  })
})

describe('changesForGoogle', () => {
  it('skickar bara de ändrade fälten', () => {
    expect(changesForGoogle({ title: 'x' })).toEqual({ title: 'x' })
  })

  it('rensar plats och beskrivning med null när texten är tom', () => {
    expect(changesForGoogle({ location: '', description: '' })).toEqual({
      location: null,
      description: null,
    })
    expect(changesForGoogle({ location: 'Rum 4', description: 'Text' })).toEqual({
      location: 'Rum 4',
      description: 'Text',
    })
  })

  it('för med tid och påminnelser oförändrade', () => {
    const time = { start: '2026-10-22', end: '2026-10-23', allDay: true }
    expect(changesForGoogle({ time, reminders: { useDefault: true } })).toEqual({
      time,
      reminders: { useDefault: true },
    })
  })
})

describe('isTimeOnly', () => {
  it('är sant bara när tiden är det enda som ändras', () => {
    const time = { start: 'a', end: 'b', allDay: false }
    expect(isTimeOnly({ time })).toBe(true)
    expect(isTimeOnly({ time, title: 'x' })).toBe(false)
    expect(isTimeOnly({ title: 'x' })).toBe(false)
    expect(isTimeOnly({ reminders: { useDefault: true } })).toBe(false)
  })
})
