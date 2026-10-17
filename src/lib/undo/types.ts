/**
 * Kommandomönster för alla ändringar (PROJECT.md §5.3). Ett kommando har två riktningar, framåt
 * (görs) och bakåt (ångras). Båda är steg med samma form:
 *
 * 1. `optimistic()` ändrar cachen direkt, synkront, så att UI uppdateras utan väntan.
 * 2. `apply()` skickar ändringen till Google.
 * 3. `rollback()` återställer cachen om `apply()` misslyckas.
 *
 * Steg ska beskriva ett absolut slutläge ("start = X"), inte en relativ ändring ("flytta 15 min").
 * Det gör att steg kan slås ihop (se `coalesce`) och att ångra alltid leder till rätt läge.
 */
export interface CommandStep {
  /** Uppdaterar cachen direkt. Får inte kasta och får inte vara asynkron. */
  optimistic: () => void
  /** Utför ändringen mot Google. Kastar vid fel. */
  apply: () => Promise<void>
  /** Återställer det `optimistic()` ändrade. Anropas bara om `apply()` kastat. */
  rollback: () => void
}

export interface UndoCommand {
  /** Läsbar beskrivning, redan översatt. Visas i toasts, t.ex. "Flytta Gympass". */
  label: string
  /**
   * Nyckel som ändringar köas på, normalt händelsens id. Steg med samma nyckel körs ett i taget i
   * den ordning de skapades. Steg med olika nycklar körs parallellt.
   */
  key: string
  /** Visa en toast när ändringen lyckats (t.ex. vid borttagning, så att den går att ångra). */
  announce?: boolean
  /**
   * Tillåt att ett steg som ännu inte startat ersätts av nästa steg med samma nyckel. Då skickas
   * bara den sista ändringen ("senaste ändringen vinner", PRD 6.4). Får bara sättas på kommandon
   * vars steg är absoluta och som kan köras mot en händelse som finns (alltså inte skapa eller ta bort).
   */
  coalesce?: boolean
  forward: CommandStep
  backward: CommandStep
}

export type UndoAction = 'do' | 'undo' | 'redo'

export type StepOutcome =
  | { status: 'applied' }
  /** Ersattes av ett senare steg innan det hann skickas. Inget anrop gjordes. */
  | { status: 'superseded' }
  | { status: 'failed'; error: unknown }

/** Utfall för `execute`, `undo` och `redo`. `empty` betyder att det inte fanns något att ångra eller göra om. */
export type CommandOutcome = StepOutcome | { status: 'empty' }

export type UndoEvent =
  | {
      type: 'failed'
      action: UndoAction
      label: string
      error: unknown
      /** Försöker igen från början (optimistisk uppdatering, anrop, rollback vid nytt fel). */
      retry: () => void
    }
  | {
      type: 'done'
      label: string
      /** Ångrar ändringen. Finns så att en toast kan erbjuda "Ångra". */
      undo: () => void
    }
  | {
      type: 'undone'
      label: string
      /** Gör om ändringen. Finns så att en toast kan erbjuda "Gör om". */
      redo: () => void
    }
  | { type: 'redone'; label: string }

/** Oföränderlig ögonblicksbild av läget, för `useSyncExternalStore`. */
export interface UndoSnapshot {
  canUndo: boolean
  canRedo: boolean
  /** Etiketten på det som skulle ångras eller göras om, för knappar och menyer. */
  undoLabel: string | null
  redoLabel: string | null
  /** Antal ändringar som väntar på svar från Google. */
  pending: number
}
