import { focusManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import { GoogleAccessError, GoogleApiError } from '@/lib/google'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import { setupFakeGoogleClient } from '@/test/fakeGoogleClient'
import { useCalendars } from './useCalendars'
import { EVENTS_POLL_INTERVAL_MS } from './eventsQuery'
import { useEventsForCalendars } from './useEventsForCalendars'
import { PREFETCH_DELAY_MS, usePrefetchEvents } from './usePrefetchEvents'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const NEXT_WEEK = weekRange(new Date('2026-10-28T12:00:00Z'), TZ)

function eventItem(id: string) {
  return {
    id,
    etag: `"${id}"`,
    summary: `Event ${id}`,
    start: { dateTime: '2026-10-20T09:00:00+02:00' },
    end: { dateTime: '2026-10-20T10:00:00+02:00' },
  }
}

describe('useCalendars', () => {
  it('hämtar kalendrarna via Google-klienten', async () => {
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({
      items: [{ id: 'a', summary: 'A', backgroundColor: TEST_CALENDAR_COLOR, accessRole: 'owner' }],
    }))

    const { result } = renderHook(() => useCalendars(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.calendars.map((c) => c.id)).toEqual(['a'])
    expect(getJson).toHaveBeenCalledWith('/users/me/calendarList', expect.any(Object))
  })
})

describe('useEventsForCalendars', () => {
  const CALENDARS = [{ id: 'a' }, { id: 'b' }]

  it('slår ihop händelser från alla kalendrar i kalendrarnas ordning', async () => {
    const { Wrapper } = setupFakeGoogleClient((path) => ({
      items: [eventItem(path.includes('/a/') ? 'from-a' : 'from-b')],
    }))
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: CALENDARS, range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    expect(result.current.isPending).toBe(true)
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(result.current.events.map((e) => e.id)).toEqual(['from-a', 'from-b'])
    expect(result.current.events.map((e) => e.calendarId)).toEqual(['a', 'b'])
    expect(result.current.failures).toEqual([])
    expect(result.current.accessError).toBeNull()
  })

  it('visar de kalendrar som gick bra och listar de som misslyckades', async () => {
    const { Wrapper } = setupFakeGoogleClient((path) => {
      if (path.includes('/b/')) throw new GoogleApiError('forbidden', 403)
      return { items: [eventItem('from-a')] }
    })
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: CALENDARS, range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(result.current.events.map((e) => e.id)).toEqual(['from-a'])
    expect(result.current.failures).toHaveLength(1)
    expect(result.current.failures[0]).toMatchObject({ calendarId: 'b' })
    expect(result.current.accessError).toBeNull()
  })

  it('rapporterar återkallad åtkomst som accessError', async () => {
    const { Wrapper } = setupFakeGoogleClient(() => {
      throw new GoogleAccessError('access_revoked')
    })
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: CALENDARS, range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.accessError).toBeInstanceOf(GoogleAccessError)
    })
    expect(result.current.accessError?.reason).toBe('access_revoked')
    expect(result.current.failures).toEqual([])
  })

  it('markerar kalendrar där alla sidor inte hämtades', async () => {
    const { Wrapper } = setupFakeGoogleClient((_path, params) => ({
      items: [],
      nextPageToken: String(Number(params.pageToken ?? 0) + 1),
    }))
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: [{ id: 'a' }], range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(result.current.truncatedCalendarIds).toEqual(['a'])
  })

  it('använder en egen cache-post per kalender och vecka', async () => {
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [] }))
    const { result, rerender } = renderHook(
      ({ range }) => useEventsForCalendars({ calendars: CALENDARS, range, timeZone: TZ }),
      { wrapper: Wrapper, initialProps: { range: WEEK } },
    )
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(getJson).toHaveBeenCalledTimes(2)

    rerender({ range: NEXT_WEEK })
    await waitFor(() => {
      expect(getJson).toHaveBeenCalledTimes(4)
    })

    // Tillbaka till första veckan: datan finns kvar i cachen och är färsk, så inget nytt anrop.
    rerender({ range: WEEK })
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(getJson).toHaveBeenCalledTimes(4)
  })

  it('frågar inte efter något när enabled är falskt eller listan är tom', () => {
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [] }))
    const disabled = renderHook(
      () =>
        useEventsForCalendars({
          calendars: CALENDARS,
          range: WEEK,
          timeZone: TZ,
          enabled: false,
        }),
      { wrapper: Wrapper },
    )
    const empty = renderHook(
      () => useEventsForCalendars({ calendars: [], range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    expect(getJson).not.toHaveBeenCalled()
    expect(empty.result.current.isPending).toBe(false)
    expect(empty.result.current.events).toEqual([])
    expect(disabled.result.current.isFetching).toBe(false)
  })

  it('ger samma resultatobjekt mellan renderingar när inget ändrats', async () => {
    const { Wrapper } = setupFakeGoogleClient(() => ({ items: [eventItem('x')] }))
    const { result, rerender } = renderHook(
      () =>
        // Ny array vid varje rendering, som en anropare utan useMemo skulle göra.
        useEventsForCalendars({ calendars: [{ id: 'a' }], range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    const before = result.current
    rerender()
    expect(result.current).toBe(before)
  })

  it('skiljer misslyckad uppdatering från misslyckad första hämtning', async () => {
    let failing = false
    const { Wrapper, queryClient } = setupFakeGoogleClient(() => {
      if (failing) throw new GoogleApiError('network', 0)
      return { items: [eventItem('from-a')] }
    })
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: [{ id: 'a' }], range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    failing = true
    await act(() => queryClient.invalidateQueries())

    await waitFor(() => {
      expect(result.current.refreshFailures).toHaveLength(1)
    })
    expect(result.current.failures).toEqual([])
    expect(result.current.events.map((e) => e.id)).toEqual(['from-a'])
  })
})

describe('synk av öppen period', () => {
  const installFakeTimers = () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
  }

  afterEach(() => {
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  })

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  async function renderLoaded() {
    installFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    const fake = setupFakeGoogleClient(() => ({ items: [eventItem('x')] }))
    const hook = renderHook(
      () => useEventsForCalendars({ calendars: [{ id: 'a' }], range: WEEK, timeZone: TZ }),
      { wrapper: fake.Wrapper },
    )
    await advance(0)
    expect(fake.getJson).toHaveBeenCalledTimes(1)
    return { ...fake, ...hook }
  }

  it('hämtar om var 60:e sekund', async () => {
    const { getJson } = await renderLoaded()

    await advance(EVENTS_POLL_INTERVAL_MS - 1)
    expect(getJson).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(getJson).toHaveBeenCalledTimes(2)
    await advance(EVENTS_POLL_INTERVAL_MS)
    expect(getJson).toHaveBeenCalledTimes(3)
  })

  it('hämtar inte om medan fliken är dold, men gör det när den visas igen', async () => {
    const { getJson } = await renderLoaded()

    focusManager.setFocused(false)
    await advance(5 * EVENTS_POLL_INTERVAL_MS)
    expect(getJson).toHaveBeenCalledTimes(1)

    focusManager.setFocused(true)
    await advance(0)
    expect(getJson).toHaveBeenCalledTimes(2)
  })

  it('hämtar inte om vid fokus när datan är färsk', async () => {
    const { getJson } = await renderLoaded()

    focusManager.setFocused(false)
    await advance(10_000)
    focusManager.setFocused(true)
    await advance(0)

    expect(getJson).toHaveBeenCalledTimes(1)
  })

  it('uppdaterar händelserna när något ändrats hos Google', async () => {
    installFakeTimers()
    let title = 'Före'
    const { Wrapper } = setupFakeGoogleClient(() => ({
      items: [{ ...eventItem('x'), summary: title }],
    }))
    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: [{ id: 'a' }], range: WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )
    await advance(0)
    expect(result.current.events.map((e) => e.title)).toEqual(['Före'])

    title = 'Efter'
    await advance(EVENTS_POLL_INTERVAL_MS)
    await advance(10)

    expect(result.current.events.map((e) => e.title)).toEqual(['Efter'])
  })
})

describe('usePrefetchEvents', () => {
  const installFakeTimers = () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  }
  const RANGES = [NEXT_WEEK, WEEK]

  afterEach(() => {
    vi.useRealTimers()
  })

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  function callsFor(getJson: ReturnType<typeof setupFakeGoogleClient>['getJson']) {
    return getJson.mock.calls.map(([path, params]) => ({
      calendarId: path.split('/')[2],
      timeMin: params?.timeMin,
    }))
  }

  it('hämtar varje period för varje kalender efter en kort väntan, nästa period först', async () => {
    installFakeTimers()
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [] }))
    renderHook(
      () => {
        usePrefetchEvents({
          calendars: [{ id: 'a' }, { id: 'b' }],
          ranges: RANGES,
          timeZone: TZ,
        })
      },
      { wrapper: Wrapper },
    )

    await advance(PREFETCH_DELAY_MS - 1)
    expect(getJson).not.toHaveBeenCalled()
    await advance(1)

    const calls = callsFor(getJson)
    expect(calls).toHaveLength(4)
    expect(calls.map((c) => c.calendarId)).toEqual(['a', 'b', 'a', 'b'])
    expect(calls[0]?.timeMin).toBe(toRfc3339(NEXT_WEEK.start, TZ))
    expect(calls[2]?.timeMin).toBe(toRfc3339(WEEK.start, TZ))
  })

  it('startar inte när enabled är falskt, och avbryter väntan om något ändras', async () => {
    installFakeTimers()
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [] }))
    const { rerender } = renderHook(
      ({ enabled }) => {
        usePrefetchEvents({ calendars: [{ id: 'a' }], ranges: RANGES, timeZone: TZ, enabled })
      },
      { wrapper: Wrapper, initialProps: { enabled: false } },
    )
    await advance(10 * PREFETCH_DELAY_MS)
    expect(getJson).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await advance(PREFETCH_DELAY_MS - 1)
    rerender({ enabled: false })
    await advance(10 * PREFETCH_DELAY_MS)

    expect(getJson).not.toHaveBeenCalled()
  })

  it('hämtar inte om färsk data och startar inte om vid ny array med samma intervall', async () => {
    installFakeTimers()
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [] }))
    const { rerender } = renderHook(
      () => {
        usePrefetchEvents({
          calendars: [{ id: 'a' }],
          ranges: [NEXT_WEEK, WEEK],
          timeZone: TZ,
        })
      },
      { wrapper: Wrapper },
    )
    await advance(PREFETCH_DELAY_MS)
    expect(getJson).toHaveBeenCalledTimes(2)

    rerender()
    await advance(10 * PREFETCH_DELAY_MS)

    expect(getJson).toHaveBeenCalledTimes(2)
  })

  it('delar cache med useEventsForCalendars, så att en förhämtad period öppnas utan nytt anrop', async () => {
    const { Wrapper, getJson } = setupFakeGoogleClient(() => ({ items: [eventItem('pre')] }))
    renderHook(
      () => {
        usePrefetchEvents({ calendars: [{ id: 'a' }], ranges: [NEXT_WEEK], timeZone: TZ })
      },
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(getJson).toHaveBeenCalledTimes(1)
    })

    const { result } = renderHook(
      () => useEventsForCalendars({ calendars: [{ id: 'a' }], range: NEXT_WEEK, timeZone: TZ }),
      { wrapper: Wrapper },
    )

    expect(result.current.isPending).toBe(false)
    expect(result.current.events.map((e) => e.id)).toEqual(['pre'])
    expect(getJson).toHaveBeenCalledTimes(1)
  })
})
