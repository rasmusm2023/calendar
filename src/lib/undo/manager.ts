import type {
  CommandOutcome,
  CommandStep,
  StepOutcome,
  UndoCommand,
  UndoEvent,
  UndoSnapshot,
} from './types'

export const MAX_UNDO_ENTRIES = 100

interface Task {
  step: CommandStep
  coalesce: boolean
  /** Steg som ersatts av det här. Rullas tillbaka om det här misslyckas (se `drain`). */
  superseded: CommandStep[]
  resolve: (outcome: StepOutcome) => void
}

interface Lane {
  queue: Task[]
  running: boolean
}

const EMPTY_SNAPSHOT: UndoSnapshot = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  pending: 0,
}

/**
 * Kör kommandon enligt PROJECT.md §5.3: optimistisk uppdatering, anrop, rollback vid fel. Håller
 * ångra- och gör om-staplar. Känner inte till React, TanStack Query eller Google.
 *
 * - Ändringar med samma nyckel köas och körs i ordning. Olika nycklar körs parallellt.
 * - Ett kommando med `coalesce` ersätter ett väntande steg med samma nyckel, så att bara den sista
 *   ändringen skickas. Misslyckas den får UI:t tillbaka läget före det första av de ihopslagna stegen.
 * - Misslyckas ett steg rullas det tillbaka, kommandot tas bort ur staplarna och en `failed`-händelse
 *   med `retry` skickas.
 */
export class UndoManager {
  private readonly undoStack: UndoCommand[] = []
  private redoStack: UndoCommand[] = []
  private readonly lanes = new Map<string, Lane>()
  private pending = 0
  private snapshot: UndoSnapshot = EMPTY_SNAPSHOT
  private readonly snapshotListeners = new Set<() => void>()
  private readonly eventListeners = new Set<(event: UndoEvent) => void>()

  /** För `useSyncExternalStore`. Returnerar samma objekt så länge inget ändrats. */
  getSnapshot = (): UndoSnapshot => this.snapshot

  /** Anropas när ögonblicksbilden ändrats. Returnerar en funktion som avregistrerar. */
  subscribe = (listener: () => void): (() => void) => {
    this.snapshotListeners.add(listener)
    return () => {
      this.snapshotListeners.delete(listener)
    }
  }

  /** Lyssna på misslyckanden och bekräftelser (för toasts och felrapportering). */
  onEvent = (listener: (event: UndoEvent) => void): (() => void) => {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /** Kör ett nytt kommando. Ändringen syns direkt. Löser sig när Google svarat. */
  async execute(command: UndoCommand): Promise<CommandOutcome> {
    this.undoStack.push(command)
    if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift()
    this.redoStack = []
    this.refresh()

    const outcome = await this.run(command, command.forward)
    if (outcome.status === 'failed') {
      this.remove(this.undoStack, command)
      this.refresh()
      this.emit({
        type: 'failed',
        action: 'do',
        label: command.label,
        error: outcome.error,
        retry: () => {
          void this.execute(command)
        },
      })
    } else if (outcome.status === 'applied' && command.announce === true) {
      this.emit({
        type: 'done',
        label: command.label,
        undo: () => {
          void this.undo()
        },
      })
    }
    return outcome
  }

  /** Ångrar den senaste ändringen. */
  async undo(): Promise<CommandOutcome> {
    const command = this.undoStack.pop()
    if (!command) return { status: 'empty' }
    this.redoStack.push(command)
    this.refresh()

    const outcome = await this.run(command, command.backward)
    if (outcome.status === 'failed') {
      this.remove(this.redoStack, command)
      this.undoStack.push(command)
      this.refresh()
      this.emit({
        type: 'failed',
        action: 'undo',
        label: command.label,
        error: outcome.error,
        retry: () => {
          void this.undo()
        },
      })
    } else if (outcome.status === 'applied') {
      this.emit({
        type: 'undone',
        label: command.label,
        redo: () => {
          void this.redo()
        },
      })
    }
    return outcome
  }

  /** Gör om den senast ångrade ändringen. */
  async redo(): Promise<CommandOutcome> {
    const command = this.redoStack.pop()
    if (!command) return { status: 'empty' }
    this.undoStack.push(command)
    this.refresh()

    const outcome = await this.run(command, command.forward)
    if (outcome.status === 'failed') {
      this.remove(this.undoStack, command)
      this.redoStack.push(command)
      this.refresh()
      this.emit({
        type: 'failed',
        action: 'redo',
        label: command.label,
        error: outcome.error,
        retry: () => {
          void this.redo()
        },
      })
    } else if (outcome.status === 'applied') {
      this.emit({ type: 'redone', label: command.label })
    }
    return outcome
  }

  /** Tömmer staplarna, t.ex. vid utloggning. Anrop som redan skickats avbryts inte. */
  clear(): void {
    this.undoStack.length = 0
    this.redoStack = []
    this.refresh()
  }

  private run(command: UndoCommand, step: CommandStep): Promise<StepOutcome> {
    step.optimistic()
    this.pending += 1
    this.refresh()

    return new Promise<StepOutcome>((resolve) => {
      const task: Task = {
        step,
        coalesce: command.coalesce === true,
        superseded: [],
        resolve,
      }

      let lane = this.lanes.get(command.key)
      if (!lane) {
        lane = { queue: [], running: false }
        this.lanes.set(command.key, lane)
      }

      const tail = lane.queue.at(-1)
      if (task.coalesce && tail?.coalesce === true) {
        lane.queue.pop()
        task.superseded = [...tail.superseded, tail.step]
        this.pending -= 1
        this.refresh()
        tail.resolve({ status: 'superseded' })
      }

      lane.queue.push(task)
      if (!lane.running) void this.drain(command.key, lane)
    })
  }

  private async drain(key: string, lane: Lane): Promise<void> {
    lane.running = true
    for (let task = lane.queue.shift(); task; task = lane.queue.shift()) {
      let outcome: StepOutcome
      try {
        await task.step.apply()
        outcome = { status: 'applied' }
      } catch (error) {
        // Först det här steget, sedan de ersatta stegen i omvänd ordning. Då hamnar cachen i läget
        // före det första ihopslagna steget, vilket är det som faktiskt finns hos Google.
        for (const step of [task.step, ...task.superseded.toReversed()]) {
          try {
            step.rollback()
          } catch {
            // Ett misslyckat rollback ska inte hindra de övriga.
          }
        }
        outcome = { status: 'failed', error }
      }
      this.pending -= 1
      this.refresh()
      task.resolve(outcome)
    }
    lane.running = false
    this.lanes.delete(key)
  }

  private remove(stack: UndoCommand[], command: UndoCommand): void {
    const index = stack.lastIndexOf(command)
    if (index !== -1) stack.splice(index, 1)
  }

  private refresh(): void {
    const undoTop = this.undoStack.at(-1)
    const redoTop = this.redoStack.at(-1)
    const next: UndoSnapshot = {
      canUndo: undoTop !== undefined,
      canRedo: redoTop !== undefined,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
      pending: this.pending,
    }
    const current = this.snapshot
    const unchanged =
      next.canUndo === current.canUndo &&
      next.canRedo === current.canRedo &&
      next.undoLabel === current.undoLabel &&
      next.redoLabel === current.redoLabel &&
      next.pending === current.pending
    if (unchanged) return
    this.snapshot = next
    for (const listener of this.snapshotListeners) listener()
  }

  private emit(event: UndoEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }
}
