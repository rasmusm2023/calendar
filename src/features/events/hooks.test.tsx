import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { weekRange } from '@/lib/dates'
import { GoogleAccessError, GoogleApiError } from '@/lib/google'
import { TEST_CALENDAR_COLOR } from '@/test/fixtures'
import { setupFakeGoogleClient } from '@/test/fakeGoogleClient'
import { useCalendars } from './useCalendars'
import { useEventsForCalendars } from './useEventsForCalendars'

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
