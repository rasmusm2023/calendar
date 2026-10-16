import { describe, expect, it } from 'vitest'
import { GoogleApiError } from '@/lib/google'
import { UndoManager } from '@/lib/undo'
import {
  CAL,
  TZ,
  instance,
  rawMaster,
  setupSeries,
  standalone,
  type FakeSeriesOptions,
  type SeriesCall,
} from '@/test/fakeSeriesGoogle'
import type { EventEdit } from './eventEdit'
import type { SeriesScope } from './recurringScope'
import { updateSeriesCommand } from './updateSeriesCommand'

const DAILY = ['RRULE:FREQ=DAILY']
const THREE = [instance(20), instance(21), instance(22)]

function setup(options: Partial<FakeSeriesOptions> = {}) {
  const fake = setupSeries({
    masters: [rawMaster(DAILY)],
    cached: THREE,
    ...options,
  })
  const manager = new UndoManager()
  const command = (scope: SeriesScope, edit: EventEdit, target = instance(21)) =>
    updateSeriesCommand(
      {
        client: fake.client,
        queryClient: fake.queryClient,
        timeZone: TZ,
        label: 'Redigera Veckomöte',
        newId: fake.newId,
      },
      { instance: target, scope, edit },
    )
  const patchBodies = () =>
    fake
      .writes()
      .filter((call) => call.method === 'PATCH')
      .map((call) => call.body)
  return { ...fake, manager, command, patchBodies }
}

const MOVE_NEXT_DAY: EventEdit = {
  time: { start: '2026-10-22T10:30:00+02:00', end: '2026-10-22T11:30:00+02:00', allDay: false },
}

describe('updateSeriesCommand: alla', () => {
  it('ändrar titeln på alla förekomster direkt, och på huvudhändelsen hos Google utan If-Match', async () => {
    const ctx = setup()

    const pending = ctx.manager.execute(ctx.command('all', { title: 'Nytt namn' }))

    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Nytt namn',
      '10-21T09:00 Nytt namn',
      '10-22T09:00 Nytt namn',
    ])
    expect(await pending).toEqual({ status: 'applied' })
    expect(ctx.writes()).toEqual([
      { method: 'PATCH', path: '/calendars/cal/events/m1', body: { summary: 'Nytt namn' } },
    ])
  })

  it('flyttar alla förekomster och huvudhändelsen lika många dagar, med nytt klockslag och längd', async () => {
    const ctx = setup()

    const pending = ctx.manager.execute(ctx.command('all', MOVE_NEXT_DAY))

    expect(ctx.byDay()).toEqual([
      '10-21T10:30 Veckomöte',
      '10-22T10:30 Veckomöte',
      '10-23T10:30 Veckomöte',
    ])
    await pending
    expect(ctx.patchBodies()).toEqual([
      {
        start: { dateTime: '2026-10-15T10:30:00+02:00', date: null, timeZone: TZ },
        end: { dateTime: '2026-10-15T11:30:00+02:00', date: null, timeZone: TZ },
      },
    ])
  })

  it('flyttar veckodagen i regeln när förekomsten flyttas till en annan dag', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=WEEKLY;BYDAY=WE'])] })

    await ctx.manager.execute(ctx.command('all', MOVE_NEXT_DAY))

    expect(ctx.patchBodies()[0]).toMatchObject({ recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'] })
  })

  it('misslyckas utan att skicka något om regeln inte går att flytta, och återställer vyn', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=MONTHLY;BYDAY=2WE'])] })

    const outcome = await ctx.manager.execute(ctx.command('all', MOVE_NEXT_DAY))

    expect(outcome.status).toBe('failed')
    expect(ctx.writes()).toEqual([])
    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Veckomöte',
      '10-22T09:00 Veckomöte',
    ])
  })

  it('rullar tillbaka när Google svarar med fel', async () => {
    const ctx = setup({
      fail: (call) => (call.method === 'PATCH' ? new GoogleApiError('forbidden', 403) : undefined),
    })

    const outcome = await ctx.manager.execute(ctx.command('all', { title: 'Nytt namn' }))

    expect(outcome.status).toBe('failed')
    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Veckomöte',
      '10-22T09:00 Veckomöte',
    ])
  })

  it('ångra sätter tillbaka huvudhändelsens fält och regler, och gör om går framåt igen', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=WEEKLY;BYDAY=WE'])] })
    await ctx.manager.execute(ctx.command('all', { ...MOVE_NEXT_DAY, title: 'Nytt' }))
    expect(ctx.masters.get('m1')).toMatchObject({
      summary: 'Nytt',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
    })

    await ctx.manager.undo()
    expect(ctx.masters.get('m1')).toMatchObject({
      summary: 'Veckomöte',
      start: { dateTime: '2026-10-14T09:00:00+02:00' },
      end: { dateTime: '2026-10-14T10:00:00+02:00' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'],
    })
    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Veckomöte',
      '10-22T09:00 Veckomöte',
    ])

    await ctx.manager.redo()
    expect(ctx.masters.get('m1')).toMatchObject({
      summary: 'Nytt',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
    })
  })

  it('rensar plats och beskrivning med null och ändrar bara det som ändrats', async () => {
    const ctx = setup()

    await ctx.manager.execute(ctx.command('all', { location: '' }))

    expect(ctx.patchBodies()).toEqual([{ location: null }])
  })

  it('byter UNTIL mellan datum och tid när serien går från tidsbestämd till heldag', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=DAILY;UNTIL=20261231T225959Z'])] })

    await ctx.manager.execute(
      ctx.command('all', { time: { start: '2026-10-21', end: '2026-10-22', allDay: true } }),
    )

    expect(ctx.patchBodies()[0]).toMatchObject({
      start: { date: '2026-10-14', dateTime: null },
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261231'],
    })
  })
})

describe('updateSeriesCommand: denna och följande', () => {
  it('ändrar bara förekomsten och senare förekomster i vyn', async () => {
    const ctx = setup()

    const pending = ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }))

    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Nytt namn',
      '10-22T09:00 Nytt namn',
    ])
    await pending
  })

  it('skapar en ny serie från förekomsten först, och kortar sedan av den gamla strax före den', async () => {
    const ctx = setup()

    await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }))

    const [insert, patch] = ctx.writes()
    expect(insert).toMatchObject({
      method: 'POST',
      path: '/calendars/cal/events',
      body: {
        id: 'new1',
        summary: 'Nytt namn',
        location: 'Rum 4',
        recurrence: ['RRULE:FREQ=DAILY'],
        start: { dateTime: '2026-10-21T09:00:00+02:00', timeZone: TZ },
        end: { dateTime: '2026-10-21T10:00:00+02:00', timeZone: TZ },
      },
    })
    expect(patch).toEqual({
      method: 'PATCH',
      path: '/calendars/cal/events/m1',
      body: { recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'] },
    })
    expect(ctx.writes().every((call) => call.ifMatch === undefined)).toBe(true)
  })

  it('låter den nya serien börja på den nya tiden och flyttar regeln med', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=WEEKLY;BYDAY=WE'])] })

    await ctx.manager.execute(ctx.command('following', MOVE_NEXT_DAY))

    expect(ctx.writes()[0]?.body).toMatchObject({
      start: { dateTime: '2026-10-22T10:30:00+02:00' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
    })
    expect(ctx.writes()[1]?.body).toEqual({
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261021T065959Z'],
    })
  })

  it('räknar ut hur många förekomster som återstår när serien har COUNT', async () => {
    const ctx = setup({
      masters: [rawMaster(['RRULE:FREQ=DAILY;COUNT=10'])],
      instanceCount: 7,
    })

    await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }))

    const instances = ctx.calls.find((call) => call.path.endsWith('/instances'))
    expect(instances?.params).toMatchObject({
      timeMin: '2026-10-14T09:00:00+02:00',
      timeMax: '2026-10-21T09:00:00+02:00',
    })
    expect(ctx.writes()[0]?.body).toMatchObject({ recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] })
    expect(ctx.writes()[1]?.body).toEqual({
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'],
    })
  })

  it('ändrar hela serien om förekomsten är den första, utan att skapa någon ny serie', async () => {
    const first = instance(14)
    const ctx = setup({ cached: [first, instance(15)] })

    await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }, first))

    expect(ctx.writes()).toEqual([
      { method: 'PATCH', path: '/calendars/cal/events/m1', body: { summary: 'Nytt namn' } },
    ])
  })

  it('tar bort den nya serien och rullar tillbaka om avkortningen misslyckas', async () => {
    const ctx = setup({
      fail: (call) => (call.method === 'PATCH' ? new GoogleApiError('server', 500) : undefined),
    })

    const outcome = await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }))

    expect(outcome.status).toBe('failed')
    expect(ctx.writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /calendars/cal/events',
      'PATCH /calendars/cal/events/m1',
      'DELETE /calendars/cal/events/new1',
    ])
    expect(ctx.masters.has('new1')).toBe(false)
    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Veckomöte',
      '10-22T09:00 Veckomöte',
    ])
  })

  it('återanvänder id:t vid nytt försök om den nya serien inte kunde tas bort', async () => {
    let patches = 0
    const ctx = setup({
      fail: (call) => {
        if (call.method === 'PATCH') {
          patches += 1
          return patches === 1 ? new GoogleApiError('server', 500) : undefined
        }
        return call.method === 'DELETE' ? new GoogleApiError('server', 500) : undefined
      },
    })
    const command = ctx.command('following', { title: 'Nytt namn' })

    await expect(command.forward.apply()).rejects.toBeInstanceOf(GoogleApiError)
    await command.forward.apply()

    const inserts = ctx.writes().filter((call) => call.method === 'POST')
    expect(inserts.map((call) => call.body?.id)).toEqual(['new1', 'new1'])
  })

  it('ångra sätter tillbaka den gamla regeln och tar bort den nya serien, gör om skapar en ny med nytt id', async () => {
    const ctx = setup()
    await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }))
    expect(ctx.masters.has('new1')).toBe(true)

    await ctx.manager.undo()
    expect(ctx.masters.get('m1')).toMatchObject({ recurrence: DAILY })
    expect(ctx.masters.has('new1')).toBe(false)
    expect(ctx.byDay()).toEqual([
      '10-20T09:00 Veckomöte',
      '10-21T09:00 Veckomöte',
      '10-22T09:00 Veckomöte',
    ])

    await ctx.manager.redo()
    expect(ctx.masters.has('new2')).toBe(true)
    expect(ctx.masters.get('m1')).toMatchObject({
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'],
    })
  })

  it('arbetar på ursprungstiden när förekomsten flyttats', async () => {
    const moved = instance(21, {
      start: '2026-10-21T13:00:00+02:00',
      end: '2026-10-21T14:00:00+02:00',
    })
    const ctx = setup({ cached: [instance(20), moved, instance(22)] })

    await ctx.manager.execute(ctx.command('following', { title: 'Nytt namn' }, moved))

    expect(ctx.writes()[0]?.body).toMatchObject({
      start: { dateTime: '2026-10-21T13:00:00+02:00' },
    })
    expect(ctx.writes()[1]?.body).toEqual({
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'],
    })
  })
})

describe('updateSeriesCommand: övrigt', () => {
  it('köas per serie, så att ändringar av samma serie körs i ordning', () => {
    const ctx = setup()
    expect(ctx.command('all', { title: 'A' }).key).toBe(`${CAL}/m1`)
  })

  it('kräver att händelsen är en förekomst av en serie', () => {
    const ctx = setup()
    expect(() => ctx.command('all', { title: 'A' }, standalone(21))).toThrow()
  })

  it('anropar inte Google under den optimistiska uppdateringen', () => {
    const ctx = setup()
    const calls: SeriesCall[] = ctx.calls
    ctx.command('all', { title: 'A' }).forward.optimistic()
    expect(calls).toEqual([])
  })
})
