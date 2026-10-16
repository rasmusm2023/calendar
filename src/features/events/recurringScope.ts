import type { CalEvent } from '@/types'

/**
 * Vad en ändring av en återkommande händelse gäller (PRD 6.7):
 * - `this`: bara den här förekomsten (blir ett undantag hos Google)
 * - `following`: den här och alla senare (serien delas i två)
 * - `all`: hela serien
 */
export type RecurringScope = 'this' | 'following' | 'all'

/** Scope som ändrar själva serien, i stället för en enskild förekomst. */
export type SeriesScope = Exclude<RecurringScope, 'this'>

/** Är händelsen en förekomst av en återkommande händelse? */
export function isRecurringInstance(event: CalEvent): boolean {
  return event.recurringEventId !== undefined
}

export function isSeriesScope(scope: RecurringScope): scope is SeriesScope {
  return scope !== 'this'
}
