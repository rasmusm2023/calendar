import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import type { EventsResult } from '@/lib/google'
import type { CalEvent } from '@/types'
import {
  addEventToCache,
  cancelEventQueries,
  findEventInCache,
  removeEventFromCache,
  updateEventInCache,
} from './eventsCache'
import { queryKeys } from './queryKeys'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const NEXT_WEEK = weekRange(new Date('2026-10-28T12:00:00Z'), TZ)

function keyFor(calendarId: string, range = WEEK) {
  return queryKeys.eventsInRange(
    calendarId,
    toRfc3339(range.start, TZ),
    toRfc3339(range.end, TZ),
    TZ,
  )
}

function event(id: string, overrides: Partial<CalEvent> = {}): CalEvent {
  return {
    id,
    calendarId: 'a',
    etag: `"${id}"`,
    title: id,
    start: '2026-10-21T09:00:00+02:00',
    end: '2026-10-21T10:00:00+02:00',
    allDay: false,
    important: false,
    ...overrides,
  }
}

function result(...events: CalEvent[]): EventsResult {
  return { events, issues: [], truncated: false }
}

describe('eventsCache', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
  })

  function ids(key: readonly unknown[]) {
    return queryClient.getQueryData<EventsResult>(key)?.events.map((e) => e.id)
  }

  describe('addEventToCache', () => {
    it('lägger in händelsen i intervallet den hör hemma i', () => {
      queryClient.setQueryData(keyFor('a'), result(event('old')))

      addEventToCache(queryClient, event('new'))

      expect(ids(keyFor('a'))).toEqual(['old', 'new'])
    })

    it('hoppar över intervall som händelsen inte överlappar och andra kalendrar', () => {
      queryClient.setQueryData(keyFor('a'), result())
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result())
      queryClient.setQueryData(keyFor('b'), result())

      addEventToCache(queryClient, event('new'))

      expect(ids(keyFor('a'))).toEqual(['new'])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual([])
      expect(ids(keyFor('b'))).toEqual([])
    })

    it('lägger in en händelse som sträcker sig över flera intervall i alla', () => {
      queryClient.setQueryData(keyFor('a'), result())
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result())

      addEventToCache(
        queryClient,
        event('long', { start: '2026-10-25T20:00:00+01:00', end: '2026-10-26T08:00:00+01:00' }),
      )

      expect(ids(keyFor('a'))).toEqual(['long'])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual(['long'])
    })

    it('klarar heldagshändelser, och slutet är exklusivt', () => {
      queryClient.setQueryData(keyFor('a'), result())
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result())

      // Söndag 25 okt, en dag: hör bara till veckan som slutar där.
      addEventToCache(
        queryClient,
        event('day', { allDay: true, start: '2026-10-25', end: '2026-10-26' }),
      )

      expect(ids(keyFor('a'))).toEqual(['day'])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual([])
    })

    it('ersätter en händelse med samma id i stället för att lägga till en dubblett', () => {
      queryClient.setQueryData(keyFor('a'), result(event('x', { title: 'Före' })))

      addEventToCache(queryClient, event('x', { title: 'Efter' }))

      expect(queryClient.getQueryData<EventsResult>(keyFor('a'))?.events).toEqual([
        expect.objectContaining({ id: 'x', title: 'Efter' }),
      ])
    })

    it('flyttar en befintlig händelse ut ur intervall den inte längre hör till', () => {
      queryClient.setQueryData(keyFor('a'), result(event('x')))
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result())

      addEventToCache(
        queryClient,
        event('x', { start: '2026-10-28T09:00:00+01:00', end: '2026-10-28T10:00:00+01:00' }),
      )

      expect(ids(keyFor('a'))).toEqual([])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual(['x'])
    })

    it('rör inte poster som ännu saknar data', () => {
      void queryClient.query({
        queryKey: keyFor('a'),
        queryFn: () => new Promise(() => undefined),
      })

      addEventToCache(queryClient, event('new'))

      expect(queryClient.getQueryData(keyFor('a'))).toBeUndefined()
    })

    it('behåller samma objekt när inget ändrades', () => {
      const data = result(event('old'))
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), data)

      addEventToCache(queryClient, event('new'))

      expect(queryClient.getQueryData(keyFor('a', NEXT_WEEK))).toBe(data)
    })

    it('behåller övriga fält i posten', () => {
      queryClient.setQueryData(keyFor('a'), { events: [], issues: [], truncated: true })

      addEventToCache(queryClient, event('new'))

      expect(queryClient.getQueryData<EventsResult>(keyFor('a'))?.truncated).toBe(true)
    })
  })

  describe('findEventInCache', () => {
    it('hittar händelsen i valfritt cachat intervall för kalendern', () => {
      queryClient.setQueryData(keyFor('a'), result(event('y')))
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result(event('x')))

      expect(findEventInCache(queryClient, { calendarId: 'a', eventId: 'x' })?.id).toBe('x')
    })

    it('ger undefined för en händelse som saknas eller finns i en annan kalender', () => {
      queryClient.setQueryData(keyFor('b'), result(event('x', { calendarId: 'b' })))

      expect(findEventInCache(queryClient, { calendarId: 'a', eventId: 'x' })).toBeUndefined()
    })
  })

  describe('updateEventInCache', () => {
    it('ändrar fälten och behåller resten', () => {
      queryClient.setQueryData(keyFor('a'), result(event('x', { etag: '"1"' })))

      updateEventInCache(queryClient, { calendarId: 'a', eventId: 'x' }, { etag: '"2"' })

      expect(queryClient.getQueryData<EventsResult>(keyFor('a'))?.events).toEqual([
        expect.objectContaining({ id: 'x', etag: '"2"', title: 'x' }),
      ])
    })

    it('flyttar händelsen till rätt intervall när tiden ändras', () => {
      queryClient.setQueryData(keyFor('a'), result(event('x')))
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result())

      updateEventInCache(
        queryClient,
        { calendarId: 'a', eventId: 'x' },
        { start: '2026-10-28T09:00:00+01:00', end: '2026-10-28T10:00:00+01:00' },
      )

      expect(ids(keyFor('a'))).toEqual([])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual(['x'])
    })

    it('gör ingenting för en händelse som inte finns i cachen', () => {
      const data = result(event('y'))
      queryClient.setQueryData(keyFor('a'), data)

      updateEventInCache(queryClient, { calendarId: 'a', eventId: 'x' }, { title: 'Ny' })

      expect(queryClient.getQueryData(keyFor('a'))).toBe(data)
    })
  })
  describe('removeEventFromCache', () => {
    it('tar bort händelsen ur alla intervall för kalendern, men inte ur andra kalendrar', () => {
      queryClient.setQueryData(keyFor('a'), result(event('x'), event('y')))
      queryClient.setQueryData(keyFor('a', NEXT_WEEK), result(event('x')))
      queryClient.setQueryData(keyFor('b'), result(event('x', { calendarId: 'b' })))

      removeEventFromCache(queryClient, { calendarId: 'a', eventId: 'x' })

      expect(ids(keyFor('a'))).toEqual(['y'])
      expect(ids(keyFor('a', NEXT_WEEK))).toEqual([])
      expect(ids(keyFor('b'))).toEqual(['x'])
    })

    it('behåller samma objekt när händelsen inte fanns', () => {
      const data = result(event('y'))
      queryClient.setQueryData(keyFor('a'), data)

      removeEventFromCache(queryClient, { calendarId: 'a', eventId: 'x' })

      expect(queryClient.getQueryData(keyFor('a'))).toBe(data)
    })
  })

  describe('cancelEventQueries', () => {
    it('avbryter en pågående hämtning och behåller datan från före', async () => {
      const before = result(event('old'))
      queryClient.setQueryData(keyFor('a'), before)
      void queryClient.query({
        queryKey: keyFor('a'),
        queryFn: () => new Promise<EventsResult>(() => undefined),
        staleTime: 0,
      })
      expect(queryClient.isFetching({ queryKey: keyFor('a') })).toBe(1)

      cancelEventQueries(queryClient, 'a')
      await Promise.resolve()

      expect(queryClient.isFetching({ queryKey: keyFor('a') })).toBe(0)
      expect(queryClient.getQueryData(keyFor('a'))).toBe(before)
    })
  })
})
