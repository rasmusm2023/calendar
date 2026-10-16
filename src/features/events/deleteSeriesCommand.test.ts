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
} from '@/test/fakeSeriesGoogle'
import { deleteSeriesCommand } from './deleteSeriesCommand'
import type { SeriesScope } from './recurringScope'

const DAILY = ['RRULE:FREQ=DAILY']
const THREE = [instance(20), instance(21), instance(22)]

function setup(options: Partial<FakeSeriesOptions> = {}) {
  const fake = setupSeries({ masters: [rawMaster(DAILY)], cached: THREE, ...options })
  const manager = new UndoManager()
  const command = (scope: SeriesScope, target = instance(21)) =>
    deleteSeriesCommand(
      {
        client: fake.client,
        queryClient: fake.queryClient,
        timeZone: TZ,
        label: 'Ta bort Veckomöte',
        newId: fake.newId,
      },
      { instance: target, scope },
    )
  return { ...fake, manager, command }
}

describe('deleteSeriesCommand: alla', () => {
  it('tar bort alla förekomster direkt och huvudhändelsen hos Google, utan If-Match', async () => {
    const ctx = setup()

    const pending = ctx.manager.execute(ctx.command('all'))

    expect(ctx.byDay()).toEqual([])
    expect(await pending).toEqual({ status: 'applied' })
    expect(ctx.writes()).toEqual([{ method: 'DELETE', path: '/calendars/cal/events/m1' }])
    expect(ctx.masters.has('m1')).toBe(false)
  })

  it('visar en toast som går att ångra', async () => {
    const ctx = setup()
    const events: string[] = []
    ctx.manager.onEvent((event) => events.push(event.type))

    await ctx.manager.execute(ctx.command('all'))

    expect(events).toEqual(['done'])
    expect(ctx.manager.getSnapshot()).toMatchObject({ undoLabel: 'Ta bort Veckomöte' })
  })

  it('rullar tillbaka när Google svarar med fel', async () => {
    const ctx = setup({
      fail: (call) => (call.method === 'DELETE' ? new GoogleApiError('forbidden', 403) : undefined),
    })

    const outcome = await ctx.manager.execute(ctx.command('all'))

    expect(outcome.status).toBe('failed')
    expect(ctx.byDay()).toHaveLength(3)
  })

  it('ångra skapar serien på nytt med reglerna, tidszonen och ett nytt id', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=DAILY;COUNT=30', 'EXDATE:20261025'])] })
    await ctx.manager.execute(ctx.command('all'))

    await ctx.manager.undo()

    expect(ctx.writes()[1]).toMatchObject({
      method: 'POST',
      path: '/calendars/cal/events',
      body: {
        id: 'new1',
        summary: 'Veckomöte',
        location: 'Rum 4',
        recurrence: ['RRULE:FREQ=DAILY;COUNT=30', 'EXDATE:20261025'],
        start: { dateTime: '2026-10-14T09:00:00+02:00', timeZone: TZ },
        end: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: TZ },
      },
    })
    expect(ctx.byDay()).toHaveLength(3)
  })

  it('gör om borttagningen på den återskapade serien', async () => {
    const ctx = setup()
    await ctx.manager.execute(ctx.command('all'))
    await ctx.manager.undo()

    await ctx.manager.redo()

    expect(ctx.writes().at(-1)).toEqual({ method: 'DELETE', path: '/calendars/cal/events/new1' })
    expect(ctx.masters.size).toBe(0)
  })

  it('tar bort allt också när förekomsten ligger senare i serien', async () => {
    const ctx = setup()

    await ctx.manager.execute(ctx.command('all', instance(22)))

    expect(ctx.byDay()).toEqual([])
  })
})

describe('deleteSeriesCommand: denna och följande', () => {
  it('tar bort förekomsten och senare, och kortar av serien strax före förekomsten', async () => {
    const ctx = setup()

    const pending = ctx.manager.execute(ctx.command('following'))

    expect(ctx.byDay()).toEqual(['10-20T09:00 Veckomöte'])
    await pending
    expect(ctx.writes()).toEqual([
      {
        method: 'PATCH',
        path: '/calendars/cal/events/m1',
        body: { recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'] },
      },
    ])
  })

  it('tar bort hela serien om förekomsten är den första', async () => {
    const first = instance(14)
    const ctx = setup({ cached: [first, instance(15)] })

    await ctx.manager.execute(ctx.command('following', first))

    expect(ctx.writes()).toEqual([{ method: 'DELETE', path: '/calendars/cal/events/m1' }])
  })

  it('ångra sätter tillbaka den gamla regeln', async () => {
    const ctx = setup({ masters: [rawMaster(['RRULE:FREQ=DAILY;COUNT=30'])] })
    await ctx.manager.execute(ctx.command('following'))

    await ctx.manager.undo()

    expect(ctx.masters.get('m1')).toMatchObject({ recurrence: ['RRULE:FREQ=DAILY;COUNT=30'] })
    expect(ctx.byDay()).toHaveLength(3)

    await ctx.manager.redo()
    expect(ctx.masters.get('m1')).toMatchObject({
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'],
    })
  })

  it('rullar tillbaka när avkortningen misslyckas', async () => {
    const ctx = setup({
      fail: (call) => (call.method === 'PATCH' ? new GoogleApiError('server', 500) : undefined),
    })

    const outcome = await ctx.manager.execute(ctx.command('following'))

    expect(outcome.status).toBe('failed')
    expect(ctx.byDay()).toHaveLength(3)
  })

  it('arbetar på ursprungstiden när förekomsten flyttats', async () => {
    const moved = instance(21, {
      start: '2026-10-22T13:00:00+02:00',
      end: '2026-10-22T14:00:00+02:00',
    })
    const ctx = setup({ cached: [instance(20), moved] })

    await ctx.manager.execute(ctx.command('following', moved))

    expect(ctx.writes()[0]?.body).toEqual({
      recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'],
    })
    expect(ctx.byDay()).toEqual(['10-20T09:00 Veckomöte'])
  })

  it('köas per serie', () => {
    expect(setup().command('all').key).toBe(`${CAL}/m1`)
  })

  it('kräver att händelsen är en förekomst av en serie', () => {
    expect(() => setup().command('all', standalone(21))).toThrow()
  })
})
