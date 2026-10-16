import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import { GoogleApiError, type EventsResult, type GoogleClient } from '@/lib/google'
import { UndoManager } from '@/lib/undo'
import { createEventCommand, type CreateEventInput } from './createEventCommand'
import { queryKeys } from './queryKeys'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const KEY = queryKeys.eventsInRange('cal', toRfc3339(WEEK.start, TZ), toRfc3339(WEEK.end, TZ), TZ)

const INPUT: CreateEventInput = {
  calendarId: 'cal',
  title: 'Gympass',
  start: '2026-10-21T17:00:00+02:00',
  end: '2026-10-21T18:00:00+02:00',
  allDay: false,
}

interface Call {
  method: string
  path: string
  body?: unknown
}

function setup(
  options: {
    failInsert?: () => Error | undefined
    failDelete?: () => Error | undefined
    /** Håller inne svaret på skapandet tills löftet infrias. */
    holdInsert?: Promise<void>
  } = {},
) {
  const calls: Call[] = []
  const requestJson = vi.fn((method: string, path: string, request?: { body?: unknown }) => {
    calls.push({ method, path, body: request?.body })
    if (method === 'POST') {
      const failure = options.failInsert?.()
      if (failure) return Promise.reject(failure)
      const body = request?.body as {
        id: string
        summary: string
        location?: string
        start: object
        end: object
      }
      const respond = () => ({
        id: body.id,
        etag: `"server-${body.id}"`,
        summary: body.summary,
        ...(body.location !== undefined && { location: body.location }),
        start: body.start,
        end: body.end,
      })
      return options.holdInsert ? options.holdInsert.then(respond) : Promise.resolve(respond())
    }
    const failure = options.failDelete?.()
    if (failure) return Promise.reject(failure)
    return Promise.resolve(undefined)
  })
  const client = { getJson: vi.fn(), requestJson } as unknown as GoogleClient
  const queryClient = new QueryClient()
  queryClient.setQueryData<EventsResult>(KEY, { events: [], issues: [], truncated: false })
  const manager = new UndoManager()
  let counter = 0
  const command = (input: CreateEventInput = INPUT) =>
    createEventCommand(
      {
        client,
        queryClient,
        timeZone: TZ,
        label: 'Ny händelse: Gympass',
        newId: () => {
          counter += 1
          return `id${String(counter)}`
        },
      },
      input,
    )
  const cached = () => queryClient.getQueryData<EventsResult>(KEY)?.events ?? []
  return { calls, client, queryClient, manager, command, cached }
}

describe('createEventCommand', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('visar händelsen direkt och skickar den till Google med eget id', async () => {
    const pending = ctx.manager.execute(ctx.command())

    expect(ctx.cached()).toEqual([
      expect.objectContaining({ id: 'id1', calendarId: 'cal', title: 'Gympass', etag: '' }),
    ])
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]).toMatchObject({
      method: 'POST',
      path: '/calendars/cal/events',
      body: {
        id: 'id1',
        summary: 'Gympass',
        start: { dateTime: '2026-10-21T17:00:00+02:00' },
        end: { dateTime: '2026-10-21T18:00:00+02:00' },
      },
    })
  })

  it('byter ut den optimistiska händelsen mot Googles svar utan att id:t ändras', async () => {
    await ctx.manager.execute(ctx.command())

    expect(ctx.cached()).toEqual([expect.objectContaining({ id: 'id1', etag: '"server-id1"' })])
  })

  it('skickar heldagar som datum', async () => {
    await ctx.manager.execute(
      ctx.command({ ...INPUT, allDay: true, start: '2026-10-21', end: '2026-10-22' }),
    )

    expect(ctx.calls[0]?.body).toMatchObject({
      start: { date: '2026-10-21' },
      end: { date: '2026-10-22' },
    })
  })

  it('tar med plats när den finns', async () => {
    await ctx.manager.execute(ctx.command({ ...INPUT, location: 'Gymmet' }))

    expect(ctx.calls[0]?.body).toMatchObject({ location: 'Gymmet' })
    expect(ctx.cached()[0]).toMatchObject({ location: 'Gymmet' })
  })

  it('rullar tillbaka och rapporterar när Google svarar med fel', async () => {
    ctx = setup({ failInsert: () => new GoogleApiError('forbidden', 403) })
    const events: string[] = []
    ctx.manager.onEvent((event) => events.push(event.type))

    const outcome = await ctx.manager.execute(ctx.command())

    expect(outcome.status).toBe('failed')
    expect(ctx.cached()).toEqual([])
    expect(events).toEqual(['failed'])
    expect(ctx.manager.getSnapshot().canUndo).toBe(false)
  })

  it('försöker igen med samma id, så att en skapad händelse inte blir en dubblett', async () => {
    let failing = true
    ctx = setup({ failInsert: () => (failing ? new GoogleApiError('network', 0) : undefined) })
    let retry: () => void = () => undefined
    ctx.manager.onEvent((event) => {
      if (event.type === 'failed') retry = event.retry
    })
    await ctx.manager.execute(ctx.command())
    expect(ctx.cached()).toEqual([])

    failing = false
    retry()
    await vi.waitFor(() => {
      expect(ctx.cached()).toHaveLength(1)
    })

    expect(ctx.calls.map((call) => (call.body as { id: string }).id)).toEqual(['id1', 'id1'])
  })

  it('ångrar genom att ta bort händelsen direkt och hos Google', async () => {
    await ctx.manager.execute(ctx.command())

    const pending = ctx.manager.undo()
    expect(ctx.cached()).toEqual([])
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls[1]).toMatchObject({ method: 'DELETE', path: '/calendars/cal/events/id1' })
  })

  it('skickar inte If-Match när ett skapande ångras', async () => {
    await ctx.manager.execute(ctx.command())
    await ctx.manager.undo()

    const [, , request] = (ctx.client.requestJson as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      string,
      { ifMatch?: string },
    ]
    expect(request.ifMatch).toBeUndefined()
  })

  it('lägger tillbaka händelsen om ångra misslyckas', async () => {
    ctx = setup({ failDelete: () => new GoogleApiError('server', 500) })
    await ctx.manager.execute(ctx.command())

    const outcome = await ctx.manager.undo()

    expect(outcome.status).toBe('failed')
    expect(ctx.cached()).toEqual([expect.objectContaining({ id: 'id1', etag: '"server-id1"' })])
  })

  it('gör om med ett nytt id, eftersom Google inte låter ett borttaget id användas igen', async () => {
    await ctx.manager.execute(ctx.command())
    await ctx.manager.undo()

    const pending = ctx.manager.redo()
    expect(ctx.cached()).toEqual([expect.objectContaining({ id: 'id2' })])
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls[2]).toMatchObject({ method: 'POST', body: { id: 'id2' } })
    expect(ctx.cached()).toEqual([expect.objectContaining({ id: 'id2', etag: '"server-id2"' })])
  })

  it('ångrar gör-om-skapandet mot det nya id:t', async () => {
    await ctx.manager.execute(ctx.command())
    await ctx.manager.undo()
    await ctx.manager.redo()
    await ctx.manager.undo()

    expect(ctx.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/calendars/cal/events/id2' })
    expect(ctx.cached()).toEqual([])
  })

  it('avbryter pågående hämtningar innan den optimistiska ändringen, så att ett sent svar inte skriver över den', async () => {
    let release: () => void = () => undefined
    ctx = setup({
      holdInsert: new Promise<void>((resolve) => {
        release = resolve
      }),
    })
    let resolveFetch: (value: EventsResult) => void = () => undefined
    void ctx.queryClient.query({
      queryKey: KEY,
      queryFn: () =>
        new Promise<EventsResult>((resolve) => {
          resolveFetch = resolve
        }),
      staleTime: 0,
    })

    const pending = ctx.manager.execute(ctx.command())
    // Hämtningen (t.ex. pollingen) svarar med gamla data medan skapandet ännu väntar på Google.
    resolveFetch({ events: [], issues: [], truncated: false })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(ctx.cached().map((event) => event.id)).toEqual(['id1'])
    release()
    await pending
  })

  it('är en toastbar ändring med tydlig etikett och nyckel per händelse', () => {
    const command = ctx.command()

    expect(command.label).toBe('Ny händelse: Gympass')
    expect(command.announce).toBe(true)
    expect(command.key).toBe('cal/id1')
    expect(command.coalesce).toBeUndefined()
  })

  it('räknar ut intervallet ur nyckeln utan att röra poster för andra kalendrar', async () => {
    const other = queryKeys.eventsInRange(
      'other',
      toRfc3339(WEEK.start, TZ),
      toRfc3339(WEEK.end, TZ),
      TZ,
    )
    ctx.queryClient.setQueryData<EventsResult>(other, { events: [], issues: [], truncated: false })

    await ctx.manager.execute(ctx.command())

    expect(ctx.queryClient.getQueryData<EventsResult>(other)?.events).toEqual([])
  })
})
