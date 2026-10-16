import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRfc3339, weekRange } from '@/lib/dates'
import { GoogleApiError, type EventsResult, type GoogleClient } from '@/lib/google'
import { UndoManager } from '@/lib/undo'
import type { CalEvent } from '@/types'
import type { EventEdit } from './eventEdit'
import { queryKeys } from './queryKeys'
import { updateEventCommand } from './updateEventCommand'

const TZ = 'Europe/Stockholm'
const WEEK = weekRange(new Date('2026-10-21T12:00:00Z'), TZ)
const KEY = queryKeys.eventsInRange('cal', toRfc3339(WEEK.start, TZ), toRfc3339(WEEK.end, TZ), TZ)

const INITIAL: CalEvent = {
  id: 'ev',
  calendarId: 'cal',
  etag: '"v1"',
  title: 'Gympass',
  start: '2026-10-21T09:00:00+02:00',
  end: '2026-10-21T10:00:00+02:00',
  allDay: false,
  location: 'Gymmet',
  description: 'Ben',
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
  important: false,
}

interface Call {
  method: string
  ifMatch: string | undefined
  body: Record<string, unknown>
}

/** Låtsas-Google för en händelse: ändringar slås in i en resurs, och varje ändring ger ny etag. */
function setup(options: { fail?: () => Error | undefined } = {}) {
  const calls: Call[] = []
  let version = 1
  let resource: Record<string, unknown> = {
    id: 'ev',
    summary: INITIAL.title,
    location: INITIAL.location,
    description: INITIAL.description,
    reminders: INITIAL.reminders,
    start: { dateTime: INITIAL.start },
    end: { dateTime: INITIAL.end },
  }
  const requestJson = vi.fn(
    (
      method: string,
      _path: string,
      request: { body: Record<string, unknown>; ifMatch?: string },
    ) => {
      calls.push({ method, ifMatch: request.ifMatch, body: request.body })
      const failure = options.fail?.()
      if (failure) return Promise.reject(failure)
      if (request.ifMatch !== undefined && request.ifMatch !== `"v${String(version)}"`) {
        return Promise.reject(new GoogleApiError('preconditionFailed', 412))
      }
      const { summary, location, description, reminders } = request.body
      resource = {
        ...resource,
        ...(summary !== undefined && { summary }),
        ...(location !== undefined && { location: location ?? undefined }),
        ...(description !== undefined && { description: description ?? undefined }),
        ...(reminders !== undefined && { reminders }),
      }
      version += 1
      return Promise.resolve({ ...resource, etag: `"v${String(version)}"` })
    },
  )
  const client = { getJson: vi.fn(), requestJson } as unknown as GoogleClient
  const queryClient = new QueryClient()
  queryClient.setQueryData<EventsResult>(KEY, { events: [INITIAL], issues: [], truncated: false })
  const manager = new UndoManager()
  const command = (from: EventEdit, to: EventEdit) =>
    updateEventCommand(
      { client, queryClient, timeZone: TZ, label: 'Redigera Gympass' },
      { calendarId: 'cal', eventId: 'ev', from, to },
    )
  const cached = (): CalEvent => {
    const [event] = queryClient.getQueryData<EventsResult>(KEY)?.events ?? []
    if (!event) throw new Error('Händelsen saknas i cachen')
    return event
  }
  return { calls, manager, command, cached, queryClient }
}

describe('updateEventCommand', () => {
  let ctx: ReturnType<typeof setup>

  beforeEach(() => {
    ctx = setup()
  })

  it('ändrar flera fält direkt i cachen och skickar dem i ett anrop med If-Match', async () => {
    const pending = ctx.manager.execute(
      ctx.command(
        { title: 'Gympass', location: 'Gymmet', description: 'Ben' },
        { title: 'Löpning', location: 'Parken', description: 'Intervaller' },
      ),
    )

    expect(ctx.cached()).toMatchObject({
      title: 'Löpning',
      location: 'Parken',
      description: 'Intervaller',
    })
    expect(await pending).toEqual({ status: 'applied' })

    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]).toMatchObject({
      method: 'PATCH',
      ifMatch: '"v1"',
      body: { summary: 'Löpning', location: 'Parken', description: 'Intervaller' },
    })
    expect(ctx.cached().etag).toBe('"v2"')
  })

  it('rensar plats och beskrivning när de töms, och tar bort dem ur cachen', async () => {
    await ctx.manager.execute(
      ctx.command({ location: 'Gymmet', description: 'Ben' }, { location: '', description: '' }),
    )

    expect(ctx.calls[0]?.body).toEqual({ location: null, description: null })
    expect(ctx.cached()).not.toHaveProperty('location')
    expect(ctx.cached()).not.toHaveProperty('description')
  })

  it('skickar påminnelser och visar dem direkt', async () => {
    const reminders = {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 1440 },
      ],
    } as const

    const pending = ctx.manager.execute(
      ctx.command({ reminders: INITIAL.reminders ?? { useDefault: true } }, { reminders }),
    )
    expect(ctx.cached().reminders).toEqual(reminders)
    await pending

    expect(ctx.calls[0]?.body).toEqual({ reminders })
  })

  it('ångra sätter tillbaka alla fält, och gör om ändrar dem igen', async () => {
    await ctx.manager.execute(
      ctx.command({ title: 'Gympass', location: 'Gymmet' }, { title: 'Löpning', location: '' }),
    )

    await ctx.manager.undo()
    expect(ctx.cached()).toMatchObject({ title: 'Gympass', location: 'Gymmet' })
    expect(ctx.calls[1]?.body).toEqual({ summary: 'Gympass', location: 'Gymmet' })
    expect(ctx.calls[1]?.ifMatch).toBe('"v2"')

    await ctx.manager.redo()
    expect(ctx.cached().title).toBe('Löpning')
    expect(ctx.cached()).not.toHaveProperty('location')
  })

  it('rullar tillbaka alla fält och hämtar om från Google när sparandet misslyckas', async () => {
    ctx = setup({ fail: () => new GoogleApiError('server', 500) })
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries')

    const outcome = await ctx.manager.execute(
      ctx.command(
        { title: 'Gympass', description: 'Ben' },
        { title: 'Löpning', description: 'Intervaller' },
      ),
    )

    expect(outcome.status).toBe('failed')
    expect(ctx.cached()).toMatchObject({ title: 'Gympass', description: 'Ben' })
    expect(invalidate).toHaveBeenCalled()
  })

  it('slår inte ihop en titeländring med en senare tidsändring, så att ingen av dem går förlorad', async () => {
    const gate: { release: () => void }[] = []
    const held = setup()
    // Håll det första anropet så att nästa två hinner köas bakom det.
    const client = {
      getJson: vi.fn(),
      requestJson: vi.fn(
        (method: string, _path: string, request: { body: Record<string, unknown> }) => {
          held.calls.push({ method, ifMatch: undefined, body: request.body })
          return new Promise((resolve) => {
            gate.push({
              release: () => {
                resolve({
                  ...INITIAL,
                  id: 'ev',
                  etag: `"v${String(held.calls.length + 1)}"`,
                  summary: 'x',
                  start: { dateTime: INITIAL.start },
                  end: { dateTime: INITIAL.end },
                })
              },
            })
          })
        },
      ),
    } as unknown as GoogleClient
    const manager = new UndoManager()
    const make = (from: EventEdit, to: EventEdit) =>
      updateEventCommand(
        { client, queryClient: held.queryClient, timeZone: TZ, label: 'x' },
        { calendarId: 'cal', eventId: 'ev', from, to },
      )
    const time = (hour: string) => ({
      start: `2026-10-21T${hour}:00:00+02:00`,
      end: `2026-10-21T${String(Number(hour) + 1).padStart(2, '0')}:00:00+02:00`,
      allDay: false,
    })

    const first = manager.execute(make({ description: 'Ben' }, { description: 'Ny' }))
    const second = manager.execute(make({ title: 'Gympass' }, { title: 'Titel' }))
    const third = manager.execute(make({ time: time('09') }, { time: time('11') }))
    await vi.waitFor(() => {
      expect(gate).toHaveLength(1)
    })
    gate[0]?.release()
    await first
    await vi.waitFor(() => {
      expect(gate).toHaveLength(2)
    })
    gate[1]?.release()
    await second
    await vi.waitFor(() => {
      expect(gate).toHaveLength(3)
    })
    gate[2]?.release()
    await third

    expect(held.calls.map((call) => Object.keys(call.body))).toEqual([
      ['description'],
      ['summary'],
      ['start', 'end'],
    ])
  })

  it('markerar bara tidsändringar som ihopslagningsbara', () => {
    const time = { start: 'a', end: 'b', allDay: false }

    expect(ctx.command({ time }, { time }).coalesce).toBe(true)
    expect(ctx.command({ title: 'a' }, { title: 'b' }).coalesce).toBe(false)
    expect(ctx.command({ time, title: 'a' }, { time, title: 'b' }).coalesce).toBe(false)
  })
})
