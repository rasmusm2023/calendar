import { describe, expect, it } from 'vitest'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import type { CalendarInfo } from '@/types'
import {
  clearSelection,
  defaultVisibleIds,
  loadSelection,
  resolveVisibleCalendars,
  saveSelection,
  type SelectionStorage,
} from './calendarSelection'

function calendar(id: string, selected: boolean): CalendarInfo {
  return {
    id,
    name: id,
    backgroundColor: TEST_CALENDAR_COLOR,
    selected,
    primary: false,
    accessRole: 'owner',
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: SelectionStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
  return { storage, data }
}

const KEY = 'sc:calendarSelection:u1'

describe('defaultVisibleIds', () => {
  it('är kalendrarna som är tända i Google', () => {
    expect(
      defaultVisibleIds([calendar('a', true), calendar('b', false), calendar('c', true)]),
    ).toEqual(['a', 'c'])
  })

  it('är alla kalendrar om ingen är tänd', () => {
    expect(defaultVisibleIds([calendar('a', false), calendar('b', false)])).toEqual(['a', 'b'])
  })

  it('är tomt utan kalendrar', () => {
    expect(defaultVisibleIds([])).toEqual([])
  })
})

describe('resolveVisibleCalendars', () => {
  const calendars = [calendar('a', true), calendar('b', false), calendar('c', false)]

  it('använder Googles val när användaren inte har valt själv', () => {
    expect(resolveVisibleCalendars(calendars, null).map((c) => c.id)).toEqual(['a'])
  })

  it('följer användarens val, i kalenderlistans ordning', () => {
    expect(resolveVisibleCalendars(calendars, ['c', 'b']).map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('hoppar över kalendrar som inte längre finns och visar inte nya av sig själv', () => {
    const result = resolveVisibleCalendars([...calendars, calendar('new', true)], ['a', 'gone'])
    expect(result.map((c) => c.id)).toEqual(['a'])
  })

  it('tillåter ett tomt val', () => {
    expect(resolveVisibleCalendars(calendars, [])).toEqual([])
  })
})

describe('lagring av valet', () => {
  it('sparar och läser per användare', () => {
    const { storage } = memoryStorage()

    saveSelection(storage, 'u1', ['a', 'b'])

    expect(loadSelection(storage, 'u1')).toEqual(['a', 'b'])
    expect(loadSelection(storage, 'u2')).toBeNull()
  })

  it('ger null när inget är sparat och efter clearSelection', () => {
    const { storage } = memoryStorage()
    expect(loadSelection(storage, 'u1')).toBeNull()

    saveSelection(storage, 'u1', ['a'])
    clearSelection(storage, 'u1')

    expect(loadSelection(storage, 'u1')).toBeNull()
  })

  it.each([
    ['trasig JSON', '{not json'],
    ['fel typ', '{"a":1}'],
    ['lista med fel innehåll', '[1,2]'],
  ])('behandlar %s som inget val', (_name, raw) => {
    const { storage } = memoryStorage({ [KEY]: raw })

    expect(loadSelection(storage, 'u1')).toBeNull()
  })

  it('klarar att lagringen saknas eller kastar', () => {
    const throwing: SelectionStorage = {
      getItem: () => {
        throw new Error('blockerad')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('blockerad')
      },
    }

    expect(loadSelection(null, 'u1')).toBeNull()
    expect(loadSelection(throwing, 'u1')).toBeNull()
    expect(() => {
      saveSelection(null, 'u1', ['a'])
      saveSelection(throwing, 'u1', ['a'])
      clearSelection(throwing, 'u1')
    }).not.toThrow()
  })
})
