import { describe, expect, it, vi } from 'vitest'
import { MAX_UNDO_ENTRIES, UndoManager } from './manager'
import type { CommandStep, UndoCommand, UndoEvent } from './types'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Låtsas-cache: ett värde per nyckel, och en logg över vad som hände i vilken ordning. */
function setup() {
  const state = new Map<string, string>()
  const log: string[] = []
  const gates: Deferred[] = []

  function step(name: string, key: string, from: string, to: string, gated = false): CommandStep {
    return {
      optimistic: () => {
        state.set(key, to)
        log.push(`optimistic ${name}`)
      },
      apply: () => {
        log.push(`apply ${name}`)
        if (!gated) return Promise.resolve()
        const gate = deferred()
        gates.push(gate)
        return gate.promise
      },
      rollback: () => {
        state.set(key, from)
        log.push(`rollback ${name}`)
      },
    }
  }

  function move(key: string, from: string, to: string, options: Partial<UndoCommand> = {}) {
    const gated = options.label?.startsWith('gated') ?? false
    return {
      label: `Flytta ${key} ${from}->${to}`,
      key,
      forward: step(`${key}:${from}->${to}`, key, from, to, gated),
      backward: step(`${key}:${to}->${from}`, key, to, from),
      ...options,
    } satisfies UndoCommand
  }

  return { state, log, gates, move, step }
}

function collectEvents(manager: UndoManager): UndoEvent[] {
  const events: UndoEvent[] = []
  manager.onEvent((event) => events.push(event))
  return events
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('UndoManager.execute', () => {
  it('uppdaterar cachen direkt, innan anropet är klart', async () => {
    const t = setup()
    const manager = new UndoManager()
    const command = t.move('a', 'mån', 'tis', { label: 'gated' })

    const promise = manager.execute(command)
    expect(t.state.get('a')).toBe('tis')
    expect(t.log).toEqual(['optimistic a:mån->tis', 'apply a:mån->tis'])

    t.gates[0]?.resolve()
    await expect(promise).resolves.toEqual({ status: 'applied' })
    expect(manager.getSnapshot()).toMatchObject({ canUndo: true, undoLabel: 'gated', pending: 0 })
  })

  it('rullar tillbaka, tar bort ur ångra-stapeln och rapporterar fel vid misslyckat anrop', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)
    const error = new Error('nej')
    const command = t.move('a', 'mån', 'tis')
    command.forward.apply = () => Promise.reject(error)

    const outcome = await manager.execute(command)

    expect(outcome).toEqual({ status: 'failed', error })
    expect(t.state.get('a')).toBe('mån')
    expect(manager.getSnapshot().canUndo).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'failed', action: 'do', label: command.label, error })
  })

  it('försöker igen från början när retry anropas', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)
    const command = t.move('a', 'mån', 'tis')
    const apply = vi.fn<() => Promise<void>>()
    apply.mockRejectedValueOnce(new Error('nej')).mockResolvedValueOnce(undefined)
    command.forward.apply = apply

    await manager.execute(command)
    const failed = events[0]
    if (failed?.type !== 'failed') throw new Error('förväntade failed')
    failed.retry()
    await tick()

    expect(apply).toHaveBeenCalledTimes(2)
    expect(t.state.get('a')).toBe('tis')
    expect(manager.getSnapshot().canUndo).toBe(true)
  })

  it('skickar done med en ångra-funktion bara när announce är satt', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)

    await manager.execute(t.move('a', 'mån', 'tis'))
    expect(events).toEqual([])

    await manager.execute(t.move('b', 'mån', 'tis', { announce: true }))
    const done = events[0]
    if (done?.type !== 'done') throw new Error('förväntade done')
    expect(done.label).toBe('Flytta b mån->tis')

    done.undo()
    await tick()
    expect(t.state.get('b')).toBe('mån')
    expect(events.at(-1)).toMatchObject({ type: 'undone' })
  })

  it('tömmer gör om-stapeln när en ny ändring görs', async () => {
    const t = setup()
    const manager = new UndoManager()

    await manager.execute(t.move('a', 'mån', 'tis'))
    await manager.undo()
    expect(manager.getSnapshot().canRedo).toBe(true)

    await manager.execute(t.move('a', 'mån', 'ons'))
    expect(manager.getSnapshot().canRedo).toBe(false)
  })

  it('behåller bara de MAX_UNDO_ENTRIES senaste ändringarna', async () => {
    const t = setup()
    const manager = new UndoManager()

    for (let i = 0; i < MAX_UNDO_ENTRIES + 5; i += 1) {
      await manager.execute(t.move(`e${String(i)}`, 'a', 'b'))
    }

    let undone = 0
    while ((await manager.undo()).status !== 'empty') undone += 1
    expect(undone).toBe(MAX_UNDO_ENTRIES)
  })
})

describe('UndoManager.undo och redo', () => {
  it('ångrar och gör om i rätt ordning', async () => {
    const t = setup()
    const manager = new UndoManager()
    await manager.execute(t.move('a', 'mån', 'tis'))
    await manager.execute(t.move('a', 'tis', 'ons'))

    expect(manager.getSnapshot().undoLabel).toBe('Flytta a tis->ons')
    await manager.undo()
    expect(t.state.get('a')).toBe('tis')
    expect(manager.getSnapshot()).toMatchObject({
      undoLabel: 'Flytta a mån->tis',
      redoLabel: 'Flytta a tis->ons',
    })

    await manager.undo()
    expect(t.state.get('a')).toBe('mån')
    await manager.redo()
    await manager.redo()
    expect(t.state.get('a')).toBe('ons')
    expect(manager.getSnapshot()).toMatchObject({ canUndo: true, canRedo: false })
  })

  it('svarar empty när det inte finns något att ångra eller göra om', async () => {
    const manager = new UndoManager()
    await expect(manager.undo()).resolves.toEqual({ status: 'empty' })
    await expect(manager.redo()).resolves.toEqual({ status: 'empty' })
  })

  it('lägger tillbaka kommandot på ångra-stapeln om ångra misslyckas', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)
    const command = t.move('a', 'mån', 'tis')
    await manager.execute(command)
    command.backward.apply = () => Promise.reject(new Error('nej'))

    const outcome = await manager.undo()

    expect(outcome.status).toBe('failed')
    expect(t.state.get('a')).toBe('tis')
    expect(manager.getSnapshot()).toMatchObject({ canUndo: true, canRedo: false })
    expect(events.at(-1)).toMatchObject({ type: 'failed', action: 'undo' })
  })

  it('lägger tillbaka kommandot på gör om-stapeln om gör om misslyckas', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)
    const command = t.move('a', 'mån', 'tis')
    await manager.execute(command)
    await manager.undo()
    command.forward.apply = () => Promise.reject(new Error('nej'))

    const outcome = await manager.redo()

    expect(outcome.status).toBe('failed')
    expect(t.state.get('a')).toBe('mån')
    expect(manager.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true })
    expect(events.at(-1)).toMatchObject({ type: 'failed', action: 'redo' })
  })

  it('clear tömmer båda staplarna', async () => {
    const t = setup()
    const manager = new UndoManager()
    await manager.execute(t.move('a', 'mån', 'tis'))
    await manager.execute(t.move('b', 'mån', 'tis'))
    await manager.undo()

    manager.clear()

    expect(manager.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false })
  })
})

describe('UndoManager: köer per nyckel', () => {
  it('kör steg med samma nyckel i ordning, ett i taget', async () => {
    const t = setup()
    const manager = new UndoManager()

    const first = manager.execute(t.move('a', 'mån', 'tis', { label: 'gated 1' }))
    const second = manager.execute(t.move('a', 'tis', 'ons', { label: 'gated 2' }))

    // Båda syns direkt, men bara det första är skickat.
    expect(t.state.get('a')).toBe('ons')
    expect(t.log).toEqual(['optimistic a:mån->tis', 'apply a:mån->tis', 'optimistic a:tis->ons'])
    expect(manager.getSnapshot().pending).toBe(2)

    t.gates[0]?.resolve()
    await first
    expect(t.log.at(-1)).toBe('apply a:tis->ons')
    t.gates[1]?.resolve()
    await second
    expect(manager.getSnapshot().pending).toBe(0)
  })

  it('kör steg med olika nycklar parallellt', () => {
    const t = setup()
    const manager = new UndoManager()

    void manager.execute(t.move('a', 'mån', 'tis', { label: 'gated a' }))
    void manager.execute(t.move('b', 'mån', 'tis', { label: 'gated b' }))

    expect(t.log).toContain('apply a:mån->tis')
    expect(t.log).toContain('apply b:mån->tis')
    expect(t.gates).toHaveLength(2)
  })

  it('startar nästa steg även om det föregående misslyckades', async () => {
    const t = setup()
    const manager = new UndoManager()
    const failing = t.move('a', 'mån', 'tis', { label: 'gated 1' })
    const next = t.move('a', 'mån', 'ons', { label: 'gated 2' })

    const first = manager.execute(failing)
    const second = manager.execute(next)
    t.gates[0]?.reject(new Error('nej'))
    await first
    t.gates[1]?.resolve()

    expect((await first).status).toBe('failed')
    expect((await second).status).toBe('applied')
  })
})

describe('UndoManager: coalesce (senaste ändringen vinner)', () => {
  it('skickar bara det sista av flera väntande steg', async () => {
    const t = setup()
    const manager = new UndoManager()

    const first = manager.execute(t.move('a', 'mån', 'tis', { label: 'gated 1', coalesce: true }))
    const second = manager.execute(t.move('a', 'tis', 'ons', { label: 'gated 2', coalesce: true }))
    const third = manager.execute(t.move('a', 'ons', 'tors', { label: 'gated 3', coalesce: true }))

    await expect(second).resolves.toEqual({ status: 'superseded' })
    expect(manager.getSnapshot().pending).toBe(2)

    t.gates[0]?.resolve()
    await first
    t.gates[1]?.resolve()
    await expect(third).resolves.toEqual({ status: 'applied' })

    expect(t.log.filter((line) => line.startsWith('apply'))).toEqual([
      'apply a:mån->tis',
      'apply a:ons->tors',
    ])
    expect(t.state.get('a')).toBe('tors')
    expect(manager.getSnapshot().pending).toBe(0)
  })

  it('slår inte ihop steg som inte har coalesce', async () => {
    const t = setup()
    const manager = new UndoManager()

    const first = manager.execute(t.move('a', 'mån', 'tis', { label: 'gated 1' }))
    const second = manager.execute(t.move('a', 'tis', 'ons', { label: 'gated 2' }))
    const third = manager.execute(t.move('a', 'ons', 'tors', { label: 'gated 3' }))

    t.gates[0]?.resolve()
    await first
    t.gates[1]?.resolve()
    await second
    t.gates[2]?.resolve()
    await third

    expect(t.log.filter((line) => line.startsWith('apply'))).toHaveLength(3)
  })

  it('rullar tillbaka till läget före det första ihopslagna steget om det sista misslyckas', async () => {
    const t = setup()
    const manager = new UndoManager()
    const events = collectEvents(manager)

    const first = manager.execute(t.move('a', 'mån', 'tis', { label: 'gated 1', coalesce: true }))
    const second = manager.execute(t.move('a', 'tis', 'ons', { label: 'gated 2', coalesce: true }))
    const third = manager.execute(t.move('a', 'ons', 'tors', { label: 'gated 3', coalesce: true }))

    t.gates[0]?.resolve()
    await first
    t.gates[1]?.reject(new Error('nej'))
    await Promise.all([second, third])

    // Det första steget är redan sparat hos Google ('tis'). Allt efter det rullas tillbaka.
    expect(t.state.get('a')).toBe('tis')
    expect(events.filter((event) => event.type === 'failed')).toHaveLength(1)
  })

  it('behåller ersatta kommandon i ångra-stapeln, så att varje ångra ger ett steg', async () => {
    const t = setup()
    const manager = new UndoManager()

    const first = manager.execute(t.move('a', 'mån', 'tis', { label: 'gated 1', coalesce: true }))
    void manager.execute(t.move('a', 'tis', 'ons', { label: 'gated 2', coalesce: true }))
    void manager.execute(t.move('a', 'ons', 'tors', { label: 'gated 3', coalesce: true }))
    t.gates[0]?.resolve()
    await first
    t.gates[1]?.resolve()
    await tick()

    let undone = 0
    while ((await manager.undo()).status !== 'empty') undone += 1
    expect(undone).toBe(3)
  })
})

describe('UndoManager: ögonblicksbilden', () => {
  it('är samma objekt tills något ändras och meddelar prenumeranter', async () => {
    const t = setup()
    const manager = new UndoManager()
    const listener = vi.fn()
    const unsubscribe = manager.subscribe(listener)
    const before = manager.getSnapshot()
    expect(manager.getSnapshot()).toBe(before)

    await manager.execute(t.move('a', 'mån', 'tis'))
    expect(manager.getSnapshot()).not.toBe(before)
    expect(listener).toHaveBeenCalled()

    const calls = listener.mock.calls.length
    unsubscribe()
    await manager.execute(t.move('b', 'mån', 'tis'))
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('ändrar inte objektet när inget faktiskt ändrats', () => {
    const manager = new UndoManager()
    const before = manager.getSnapshot()
    manager.clear()
    expect(manager.getSnapshot()).toBe(before)
  })
})
