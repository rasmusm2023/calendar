import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import { GoogleApiError, type EventTime, type EventsResult, type GoogleClient } from '@/lib/google'
import { UndoManager } from '@/lib/undo'
import type { CalEvent } from '@/types'
import { queryKeys } from './queryKeys'
import { updateEventTimeCommand } from './updateEventTimeCommand'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const KEY = queryKeys.eventsInRange('cal', toRfc3339(WEEK.start, TZ), toRfc3339(WEEK.end, TZ), TZ)

const ORIGINAL: EventTime = {
  start: '2026-10-21T09:00:00+02:00',
  end: '2026-10-21T10:00:00+02:00',
  allDay: false,
}
const AT_11: EventTime = {
  start: '2026-10-21T11:00:00+02:00',
  end: '2026-10-21T12:00:00+02:00',
  allDay: false,
}
const AT_13: EventTime = {
  start: '2026-10-21T13:00:00+02:00',
  end: '2026-10-21T14:00:00+02:00',
  allDay: false,
}
const AT_15: EventTime = {
  start: '2026-10-21T15:00:00+02:00',
  end: '2026-10-21T16:00:00+02:00',
  allDay: false,
}

interface Call {
  method: string
  path: string
  ifMatch: string | undefined
  body: { start: { date?: string | null; dateTime?: string | null }; end: object }
}

/** Google svarar aldrig med 
ull-fält. Det är bara PATCH-bodyn som använder dem för att rensa ett fält. */
function withoutNulls(time: object): object {
  return Object.fromEntries(Object.entries(time).filter(([, value]) => value !== null))
}

interface Gate {
  release: () => void
}

/**
 * Låtsas-Google för en enda händelse. Håller koll på etag som riktiga Google: varje lyckad ändring ger ett nytt,
 * och en ändring med gammalt If-Match ger 412.
 */
function setup(options: { failWith?: () => Error | undefined; hold?: boolean } = {}) {
  const calls: Call[] = []
  const gates: Gate[] = []
  let serverVersion = 1
  const requestJson = vi.fn(
    (
      method: string,
      path: string,
      request: { body: Call['body']; ifMatch?: string },
    ): Promise<unknown> => {
      calls.push({ method, path, ifMatch: request.ifMatch, body: request.body })
      const failure = options.failWith?.()
      if (failure) return Promise.reject(failure)
      const respond = () => {
        if (request.ifMatch !== undefined && request.ifMatch !== `"v${String(serverVersion)}"`) {
          return Promise.reject(new GoogleApiError('preconditionFailed', 412))
        }
        serverVersion += 1
        return Promise.resolve({
          id: 'ev',
          etag: `"v${String(serverVersion)}"`,
          summary: 'Gympass',
          start: withoutNulls(request.body.start),
          end: withoutNulls(request.body.end),
        })
      }
      if (!options.hold) return respond()
      return new Promise<unknown>((resolve, reject) => {
        gates.push({
          release: () => {
            respond().then(resolve, reject)
          },
        })
      })
    },
  )
  const client = { getJson: vi.fn(), requestJson } as unknown as GoogleClient
  const queryClient = new QueryClient()
  const initial: CalEvent = {
    id: 'ev',
    calendarId: 'cal',
    etag: '"v1"',
    title: 'Gympass',
    ...ORIGINAL,
    important: false,
  }
  queryClient.setQueryData<EventsResult>(KEY, { events: [initial], issues: [], truncated: false })
  const manager = new UndoManager()
  const command = (from: EventTime, to: EventTime) =>
    updateEventTimeCommand(
      { client, queryClient, timeZone: TZ, label: 'Flytta Gympass' },
      { calendarId: 'cal', eventId: 'ev', from, to },
    )
  const cached = () => {
    const [event] = queryClient.getQueryData<EventsResult>(KEY)?.events ?? []
    if (!event) throw new Error('Händelsen saknas i cachen')
    return event
  }
  /** Väntar tills det finns `count` anrop som väntar på svar. */
  const waitForHeld = (count: number) =>
    vi.waitFor(() => {
      expect(gates.length).toBeGreaterThanOrEqual(count)
    })
  return { calls, gates, queryClient, manager, command, cached, waitForHeld }
}

describe('updateEventTimeCommand', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('flyttar händelsen direkt i cachen och skickar PATCH med etag', async () => {
    const pending = ctx.manager.execute(ctx.command(ORIGINAL, AT_11))

    expect(ctx.cached()).toMatchObject({ ...AT_11, etag: '"v1"' })
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/calendars/cal/events/ev',
      ifMatch: '"v1"',
      body: {
        start: { dateTime: AT_11.start, date: null },
        end: { dateTime: AT_11.end, date: null },
      },
    })
    // Svaret från Google ger händelsen dess nya etag.
    expect(ctx.cached()).toMatchObject({ ...AT_11, etag: '"v2"' })
  })

  it('skickar heldag som datum och rensar dateTime (byte från tidsbestämd)', async () => {
    const allDay: EventTime = { start: '2026-10-21', end: '2026-10-22', allDay: true }

    await ctx.manager.execute(ctx.command(ORIGINAL, allDay))

    expect(ctx.calls[0]?.body).toMatchObject({
      start: { date: '2026-10-21', dateTime: null },
      end: { date: '2026-10-22', dateTime: null },
    })
    expect(ctx.cached()).toMatchObject(allDay)
  })

  it('är en toastbar ändring med etikett och nyckel per händelse', () => {
    const command = ctx.command(ORIGINAL, AT_11)

    expect(command).toMatchObject({ label: 'Flytta Gympass', key: 'cal/ev', announce: true })
  })

  it('en andra ändring medan den första väntar använder den första ändringens nya etag (inget 412) och visas hela tiden på sin plats', async () => {
    ctx = setup({ hold: true })
    const first = ctx.manager.execute(ctx.command(ORIGINAL, AT_11))
    await ctx.waitForHeld(1)
    const second = ctx.manager.execute(ctx.command(AT_11, AT_13))
    expect(ctx.cached()).toMatchObject(AT_13)

    ctx.gates[0]?.release()
    expect(await first).toEqual({ status: 'applied' })
    // Mellanläget: första svaret får inte flytta tillbaka händelsen till 11:00.
    expect(ctx.cached()).toMatchObject({ ...AT_13, etag: '"v2"' })

    await ctx.waitForHeld(2)
    ctx.gates[1]?.release()
    expect(await second).toEqual({ status: 'applied' })

    expect(ctx.calls.map((call) => call.ifMatch)).toEqual(['"v1"', '"v2"'])
    expect(ctx.cached()).toMatchObject({ ...AT_13, etag: '"v3"' })
  })

  it('slår ihop flera ändringar som väntar, så att bara den sista skickas', async () => {
    ctx = setup({ hold: true })
    const first = ctx.manager.execute(ctx.command(ORIGINAL, AT_11))
    await ctx.waitForHeld(1)
    const second = ctx.manager.execute(ctx.command(AT_11, AT_13))
    const third = ctx.manager.execute(ctx.command(AT_13, AT_15))

    ctx.gates[0]?.release()
    await first
    await ctx.waitForHeld(2)
    ctx.gates[1]?.release()
    expect(await second).toEqual({ status: 'superseded' })
    expect(await third).toEqual({ status: 'applied' })

    expect(ctx.calls).toHaveLength(2)
    expect(ctx.calls[1]?.body.start.dateTime).toBe(AT_15.start)
    expect(ctx.cached()).toMatchObject(AT_15)
  })

  it('rullar tillbaka och hämtar om från Google när sparandet misslyckas', async () => {
    ctx = setup({ failWith: () => new GoogleApiError('server', 500) })
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries')

    const outcome = await ctx.manager.execute(ctx.command(ORIGINAL, AT_11))

    expect(outcome.status).toBe('failed')
    expect(ctx.cached()).toMatchObject(ORIGINAL)
    expect(invalidate).toHaveBeenCalled()
  })

  it('rullar tillbaka till tiden före alla ihopslagna ändringar när den sista misslyckas', async () => {
    let failing = false
    ctx = setup({
      hold: true,
      failWith: () => (failing ? new GoogleApiError('server', 500) : undefined),
    })
    const first = ctx.manager.execute(ctx.command(ORIGINAL, AT_11))
    await ctx.waitForHeld(1)
    void ctx.manager.execute(ctx.command(AT_11, AT_13))
    const third = ctx.manager.execute(ctx.command(AT_13, AT_15))
    // Det första anropet är redan skickat. Nästa anrop ska misslyckas.
    failing = true
    ctx.gates[0]?.release()
    await first

    expect((await third).status).toBe('failed')

    // Första ändringen gick igenom hos Google (11:00). Cachen får gå tillbaka till det, vilket är det som finns.
    expect(ctx.cached()).toMatchObject(AT_11)
  })

  it('visar det som Google har när någon annan hunnit ändra händelsen (412)', async () => {
    ctx = setup()
    // Någon annan har ändrat händelsen: cachens etag är redan gammal.
    ctx.queryClient.setQueryData<EventsResult>(KEY, {
      events: [{ ...ctx.cached(), etag: '"gammal"' }],
      issues: [],
      truncated: false,
    })

    const outcome = await ctx.manager.execute(ctx.command(ORIGINAL, AT_11))

    expect(outcome).toMatchObject({ status: 'failed' })
    expect(ctx.cached()).toMatchObject(ORIGINAL)
  })

  it('ångra flyttar tillbaka med den senaste etag', async () => {
    await ctx.manager.execute(ctx.command(ORIGINAL, AT_11))

    expect(await ctx.manager.undo()).toEqual({ status: 'applied' })

    expect(ctx.calls).toHaveLength(2)
    expect(ctx.calls[1]).toMatchObject({ ifMatch: '"v2"' })
    expect(ctx.calls[1]?.body.start.dateTime).toBe(ORIGINAL.start)
    expect(ctx.cached()).toMatchObject({ ...ORIGINAL, etag: '"v3"' })
  })

  it('gör om efter ångra', async () => {
    await ctx.manager.execute(ctx.command(ORIGINAL, AT_11))
    await ctx.manager.undo()

    expect(await ctx.manager.redo()).toEqual({ status: 'applied' })

    expect(ctx.cached()).toMatchObject(AT_11)
  })

  it('avbryter pågående hämtningar innan ändringen, så att ett sent svar inte skriver över den', async () => {
    ctx = setup({ hold: true })
    let resolveFetch: (value: EventsResult) => void = () => undefined
    const before = ctx.queryClient.getQueryData<EventsResult>(KEY)
    void ctx.queryClient.query({
      queryKey: KEY,
      queryFn: () =>
        new Promise<EventsResult>((resolve) => {
          resolveFetch = resolve
        }),
      staleTime: 0,
    })

    void ctx.manager.execute(ctx.command(ORIGINAL, AT_11))
    if (before) resolveFetch(before)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(ctx.cached()).toMatchObject(AT_11)
  })

  it('skickar inget If-Match för en händelse som ännu inte bekräftats av Google', async () => {
    ctx.queryClient.setQueryData<EventsResult>(KEY, {
      events: [{ ...ctx.cached(), etag: '' }],
      issues: [],
      truncated: false,
    })

    await ctx.manager.execute(ctx.command(ORIGINAL, AT_11))

    expect(ctx.calls[0]?.ifMatch).toBeUndefined()
  })
})
