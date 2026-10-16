import { describe, expect, it } from 'vitest'
import {
  continuationRules,
  matchUntilToKind,
  parseRule,
  ruleCount,
  ruleLines,
  shiftRecurrenceDays,
  truncateRecurrence,
  untilBefore,
} from './recurrence'

describe('parseRule', () => {
  it('delar upp en regel i delar, i ordning', () => {
    const parts = parseRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10')

    expect([...(parts ?? [])]).toEqual([
      ['FREQ', 'WEEKLY'],
      ['BYDAY', 'MO,WE'],
      ['COUNT', '10'],
    ])
  })

  it('ger null för rader som inte är regler', () => {
    expect(parseRule('EXDATE;TZID=Europe/Stockholm:20261021T090000')).toBeNull()
    expect(parseRule('RDATE:20261021')).toBeNull()
  })
})

describe('untilBefore', () => {
  it('ger dagen före för heldag, som datum', () => {
    expect(untilBefore('2026-10-21', true)).toBe('20261020')
    expect(untilBefore('2026-11-01', true)).toBe('20261031')
  })

  it('ger en sekund före starten, i UTC, för tidsbestämda', () => {
    // 09:00 i Stockholm (sommartid) är 07:00 UTC.
    expect(untilBefore('2026-10-21T09:00:00+02:00', false)).toBe('20261021T065959Z')
    expect(untilBefore('2026-10-21T00:00:00+02:00', false)).toBe('20261020T215959Z')
  })

  it('kastar för en ogiltig tid', () => {
    expect(() => untilBefore('inte en tid', false)).toThrow()
  })
})

describe('truncateRecurrence', () => {
  it('sätter UNTIL och tar bort COUNT', () => {
    expect(
      truncateRecurrence(['RRULE:FREQ=DAILY;COUNT=10'], '2026-10-21T09:00:00+02:00', false),
    ).toEqual(['RRULE:FREQ=DAILY;UNTIL=20261021T065959Z'])
  })

  it('ersätter ett UNTIL som redan finns', () => {
    expect(
      truncateRecurrence(
        ['RRULE:FREQ=WEEKLY;UNTIL=20271231T000000Z;BYDAY=WE'],
        '2026-10-21T09:00:00+02:00',
        false,
      ),
    ).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20261021T065959Z;BYDAY=WE'])
  })

  it('behåller andra rader, som EXDATE', () => {
    expect(truncateRecurrence(['RRULE:FREQ=DAILY', 'EXDATE:20261015'], '2026-10-21', true)).toEqual(
      ['RRULE:FREQ=DAILY;UNTIL=20261020', 'EXDATE:20261015'],
    )
  })
})

describe('ruleCount', () => {
  it('läser COUNT', () => {
    expect(ruleCount(['RRULE:FREQ=DAILY;COUNT=5'])).toBe(5)
  })

  it('ger undefined utan COUNT eller med ett ogiltigt värde', () => {
    expect(ruleCount(['RRULE:FREQ=DAILY'])).toBeUndefined()
    expect(ruleCount(['RRULE:FREQ=DAILY;COUNT=x'])).toBeUndefined()
    expect(ruleCount(['EXDATE:20261015'])).toBeUndefined()
  })
})

describe('continuationRules', () => {
  it('tar bara regelrader och sätter COUNT till det som återstår', () => {
    expect(continuationRules(['RRULE:FREQ=DAILY;COUNT=10', 'EXDATE:20261015'], 4)).toEqual([
      'RRULE:FREQ=DAILY;COUNT=4',
    ])
  })

  it('lämnar regler utan COUNT orörda', () => {
    expect(continuationRules(['RRULE:FREQ=WEEKLY;BYDAY=MO'], undefined)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
    ])
  })
})

describe('ruleLines', () => {
  it('filtrerar bort rader som inte är regler', () => {
    expect(ruleLines(['EXDATE:20261015', 'RRULE:FREQ=DAILY'])).toEqual(['RRULE:FREQ=DAILY'])
  })
})

describe('matchUntilToKind', () => {
  it('byter UTC-tid mot datum när serien blir heldag', () => {
    expect(matchUntilToKind(['RRULE:FREQ=DAILY;UNTIL=20261031T225959Z'], true)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261031',
    ])
  })

  it('byter datum mot sista sekunden på dagen när serien blir tidsbestämd', () => {
    expect(matchUntilToKind(['RRULE:FREQ=DAILY;UNTIL=20261031'], false)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261031T235959Z',
    ])
  })

  it('rör inte regler som redan passar eller saknar UNTIL', () => {
    expect(matchUntilToKind(['RRULE:FREQ=DAILY;UNTIL=20261031'], true)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261031',
    ])
    expect(matchUntilToKind(['RRULE:FREQ=DAILY'], true)).toEqual(['RRULE:FREQ=DAILY'])
  })
})

describe('shiftRecurrenceDays', () => {
  it('lämnar regler som följer startdatumet orörda', () => {
    for (const rule of [
      'RRULE:FREQ=DAILY',
      'RRULE:FREQ=WEEKLY;INTERVAL=2',
      'RRULE:FREQ=MONTHLY',
      'RRULE:FREQ=YEARLY;COUNT=3',
    ]) {
      expect(shiftRecurrenceDays([rule], 3)).toEqual([rule])
    }
  })

  it('flyttar veckodagarna i en veckoregel', () => {
    expect(shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'], 1)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
    ])
    expect(shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;BYDAY=SU'], 1)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
    ])
    expect(shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;BYDAY=MO'], -1)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=SU',
    ])
    expect(shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;BYDAY=TU'], 14)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
    ])
  })

  it('behåller övriga delar och rader', () => {
    expect(
      shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=6', 'EXDATE:20261015'], 1),
    ).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;COUNT=6', 'EXDATE:20261015'])
  })

  it('ändrar ingenting när dagarna inte flyttas', () => {
    expect(shiftRecurrenceDays(['RRULE:FREQ=MONTHLY;BYDAY=2TU'], 0)).toEqual([
      'RRULE:FREQ=MONTHLY;BYDAY=2TU',
    ])
  })

  it('ger null för regler som inte går att flytta på ett säkert sätt', () => {
    expect(shiftRecurrenceDays(['RRULE:FREQ=MONTHLY;BYDAY=2TU'], 1)).toBeNull()
    expect(shiftRecurrenceDays(['RRULE:FREQ=MONTHLY;BYMONTHDAY=15'], 1)).toBeNull()
    expect(shiftRecurrenceDays(['RRULE:FREQ=WEEKLY;BYDAY=1MO'], 1)).toBeNull()
    expect(shiftRecurrenceDays(['RRULE:FREQ=YEARLY;BYMONTH=3'], 1)).toBeNull()
  })
})
