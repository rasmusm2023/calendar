import { createContext, useContext } from 'react'
import type { CommandOutcome, UndoCommand, UndoSnapshot } from '@/lib/undo'

export interface UndoContextValue {
  /** Kör en ändring: syns direkt, skickas till Google, rullas tillbaka med toast vid fel. */
  execute: (command: UndoCommand) => Promise<CommandOutcome>
  undo: () => Promise<CommandOutcome>
  redo: () => Promise<CommandOutcome>
  /** Läget för knappar och menyer: går det att ångra, vad skulle ångras, väntar något på Google. */
  snapshot: UndoSnapshot
}

export const UndoContext = createContext<UndoContextValue | null>(null)

export function useUndo(): UndoContextValue {
  const value = useContext(UndoContext)
  if (!value) throw new Error('useUndo måste användas inom UndoProvider')
  return value
}
