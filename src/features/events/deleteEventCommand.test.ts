import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import { GoogleApiError, type EventsResult, type GoogleClient } from '@/lib/google'
import { UndoManager } from '@/lib/undo'
import type { CalEvent } from '@/types'
import { deleteEventCommand } from './deleteEventCommand'
import { queryKeys } from './queryKeys'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const KEY = queryKeys.eventsInRange('cal', toRfc3339(WEEK.start, TZ), toRfc3339(WEEK.end, TZ), TZ)

const EVENT: CalEvent = {
  id: 'e1',
  calendarId: 'cal',
  etag: '"1"',
  title: 'Gympass',
  start: '2026-10-21T17:00:00+02:00',
  end: '2026-10-21T18:00:00+02:00',
  allDay: false,
  location: 'Gymmet',
  description: 'Ta med handduk',
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
  important: false,
}
const OTHER: CalEvent = { ...EVENT, id: 'e2', title: 'Lunch' }

interface Call {
  method: string
  path: string
  body?: unknown
  ifMatch?: string
}

function setup(
  options: {
    failDelete?: () => Error | undefined
    failInsert?: () => Error | undefined
  } = {},
) {
  const calls: Call[] = []
  const requestJson = vi.fn(
    (method: string, path: string, request?: { body?: unknown; ifMatch?: string }) => {
      calls.push({
        method,
        path,
        body: request?.body,
        ...(request?.ifMatch !== undefined && { ifMatch: request.ifMatch }),
      })
      if (method === 'POST') {
        const failure = options.failInsert?.()
        if (failure) return Promise.reject(failure)
        const body = request?.body as Record<string, unknown>
        return Promise.resolve({ ...body, etag: `"server-${String(body.id)}"` })
      }
      const failure = options.failDelete?.()
      if (failure) return Promise.reject(failure)
      return Promise.resolve(undefined)
    },
  )
  const client = { getJson: vi.fn(), requestJson } as unknown as GoogleClient
  const queryClient = new QueryClient()
  queryClient.setQueryData<EventsResult>(KEY, {
    events: [EVENT, OTHER],
    issues: [],
    truncated: false,
  })
  const manager = new UndoManager()
  let counter = 0
  const command = () =>
    deleteEventCommand(
      {
        client,
        queryClient,
        timeZone: TZ,
        label: 'Ta bort Gympass',
        newId: () => {
          counter += 1
          return `new${String(counter)}`
        },
      },
      EVENT,
    )
  const cached = () => queryClient.getQueryData<EventsResult>(KEY)?.events ?? []
  const titles = () => cached().map((event) => event.title)
  return { calls, manager, command, cached, titles }
}

describe('deleteEventCommand', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('tar bort händelsen direkt och hos Google, utan If-Match', async () => {
    const pending = ctx.manager.execute(ctx.command())

    expect(ctx.titles()).toEqual(['Lunch'])
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls).toEqual([{ method: 'DELETE', path: '/calendars/cal/events/e1' }])
  })

  it('visar en toast som går att ångra', async () => {
    const events: string[] = []
    ctx.manager.onEvent((event) => events.push(event.type))

    await ctx.manager.execute(ctx.command())

    expect(events).toEqual(['done'])
    expect(ctx.manager.getSnapshot()).toMatchObject({ canUndo: true, undoLabel: 'Ta bort Gympass' })
  })

  it('rullar tillbaka och rapporterar när Google svarar med fel', async () => {
    ctx = setup({ failDelete: () => new GoogleApiError('forbidden', 403) })
    const events: string[] = []
    ctx.manager.onEvent((event) => events.push(event.type))

    const outcome = await ctx.manager.execute(ctx.command())

    expect(outcome.status).toBe('failed')
    expect(ctx.titles().toSorted()).toEqual(['Gympass', 'Lunch'])
    expect(events).toEqual(['failed'])
    expect(ctx.manager.getSnapshot().canUndo).toBe(false)
  })

  it('räknar en händelse som redan är borta som borttagen', async () => {
    ctx = setup({ failDelete: () => new GoogleApiError('notFound', 404) })

    const outcome = await ctx.manager.execute(ctx.command())

    expect(outcome).toEqual({ status: 'applied' })
    expect(ctx.titles()).toEqual(['Lunch'])
  })

  it('ångra skapar en kopia med samma innehåll och ett nytt id (Google tillåter inte det gamla)', async () => {
    await ctx.manager.execute(ctx.command())

    const pending = ctx.manager.undo()
    // Kopian syns direkt, innan Google svarat.
    expect(ctx.titles().toSorted()).toEqual(['Gympass', 'Lunch'])
    await pending

    const post = ctx.calls.find((call) => call.method === 'POST')
    expect(post?.path).toBe('/calendars/cal/events')
    expect(post?.body).toMatchObject({
      id: 'new1',
      summary: 'Gympass',
      location: 'Gymmet',
      description: 'Ta med handduk',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      start: { dateTime: EVENT.start },
      end: { dateTime: EVENT.end },
    })
    expect(ctx.cached()).toContainEqual(
      expect.objectContaining({ id: 'new1', etag: '"server-new1"' }),
    )
    expect(ctx.cached().some((event) => event.id === 'e1')).toBe(false)
  })

  it('gör om efter ångra genom att ta bort kopian', async () => {
    await ctx.manager.execute(ctx.command())
    await ctx.manager.undo()

    await ctx.manager.redo()

    expect(ctx.calls.at(-1)).toEqual({ method: 'DELETE', path: '/calendars/cal/events/new1' })
    expect(ctx.titles()).toEqual(['Lunch'])
  })

  it('tar bort kopian vid en andra omgång ångra och gör om utan att tappa innehållet', async () => {
    await ctx.manager.execute(ctx.command())
    await ctx.manager.undo()
    await ctx.manager.redo()

    await ctx.manager.undo()

    const posts = ctx.calls.filter((call) => call.method === 'POST')
    expect(posts.map((call) => (call.body as { id: string }).id)).toEqual(['new1', 'new2'])
    expect(posts[1]?.body).toMatchObject({ summary: 'Gympass', description: 'Ta med handduk' })
  })

  it('försöker igen med samma id när ångra misslyckas, så att det inte blir en dubblett', async () => {
    let failing = true
    ctx = setup({ failInsert: () => (failing ? new GoogleApiError('network', 0) : undefined) })
    let retry: () => void = () => undefined
    ctx.manager.onEvent((event) => {
      if (event.type === 'failed') retry = event.retry
    })
    await ctx.manager.execute(ctx.command())

    await ctx.manager.undo()
    // Kopian som visades rullas bort när det misslyckas.
    expect(ctx.titles()).toEqual(['Lunch'])

    failing = false
    retry()
    await vi.waitFor(() => {
      expect(ctx.titles().toSorted()).toEqual(['Gympass', 'Lunch'])
    })

    const ids = ctx.calls
      .filter((call) => call.method === 'POST')
      .map((call) => (call.body as { id: string }).id)
    expect(ids).toEqual(['new1', 'new1'])
  })
})
