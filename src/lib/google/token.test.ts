import { describe, expect, it, vi } from 'vitest'
import { createTokenManager, REFRESH_MARGIN_MS, type AccessToken } from './token'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function tokenExpiringIn(ms: number, accessToken = 'token'): AccessToken {
  return { accessToken, expiresAt: NOW + ms }
}

function setup(responses: (AccessToken | Error)[]) {
  let now = NOW
  const queue = [...responses]
  const fetchAccessToken = vi.fn(() => {
    const next = queue.shift()
    if (!next) return Promise.reject(new Error('unexpected fetch'))
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  const manager = createTokenManager({ source: { fetchAccessToken }, now: () => now })
  return {
    manager,
    fetchAccessToken,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('createTokenManager', () => {
  it('hämtar en token första gången och återanvänder den sedan', async () => {
    const { manager, fetchAccessToken } = setup([tokenExpiringIn(HOUR, 'first')])

    expect(await manager.getAccessToken()).toBe('first')
    expect(await manager.getAccessToken()).toBe('first')
    expect(fetchAccessToken).toHaveBeenCalledTimes(1)
  })

  it('förnyar när det är mindre än fem minuter kvar', async () => {
    const { manager, fetchAccessToken, advance } = setup([
      tokenExpiringIn(HOUR, 'old'),
      tokenExpiringIn(HOUR, 'new'),
    ])

    expect(await manager.getAccessToken()).toBe('old')
    advance(HOUR - REFRESH_MARGIN_MS - 1)
    expect(await manager.getAccessToken()).toBe('old')
    advance(2)
    expect(await manager.getAccessToken()).toBe('new')
    expect(fetchAccessToken).toHaveBeenCalledTimes(2)
  })

  it('delar ett enda anrop mellan samtidiga förfrågningar', async () => {
    const { manager, fetchAccessToken } = setup([tokenExpiringIn(HOUR, 'shared')])

    const results = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ])

    expect(results).toEqual(['shared', 'shared', 'shared'])
    expect(fetchAccessToken).toHaveBeenCalledTimes(1)
  })

  it('använder en token som sattits utan att hämta någon', async () => {
    const { manager, fetchAccessToken } = setup([])

    manager.setToken(tokenExpiringIn(HOUR, 'from-connect'))

    expect(await manager.getAccessToken()).toBe('from-connect')
    expect(fetchAccessToken).not.toHaveBeenCalled()
  })

  it('hämtar en ny token efter invalidate (t.ex. 401)', async () => {
    const { manager, fetchAccessToken } = setup([
      tokenExpiringIn(HOUR, 'a'),
      tokenExpiringIn(HOUR, 'b'),
    ])

    expect(await manager.getAccessToken()).toBe('a')
    manager.invalidate()
    expect(await manager.getAccessToken()).toBe('b')
    expect(fetchAccessToken).toHaveBeenCalledTimes(2)
  })

  it('kastar vidare fel och försöker igen vid nästa anrop', async () => {
    const { manager, fetchAccessToken } = setup([
      new Error('nätverket nere'),
      tokenExpiringIn(HOUR, 'recovered'),
    ])

    await expect(manager.getAccessToken()).rejects.toThrow('nätverket nere')
    expect(await manager.getAccessToken()).toBe('recovered')
    expect(fetchAccessToken).toHaveBeenCalledTimes(2)
  })

  it('glömmer token vid clear', async () => {
    const { manager, fetchAccessToken } = setup([
      tokenExpiringIn(HOUR, 'user-a'),
      tokenExpiringIn(HOUR, 'user-b'),
    ])

    expect(await manager.getAccessToken()).toBe('user-a')
    manager.clear()
    expect(await manager.getAccessToken()).toBe('user-b')
    expect(fetchAccessToken).toHaveBeenCalledTimes(2)
  })

  it('låter en hämtning som startade före clear inte fylla cachen igen', async () => {
    let resolveFirst: (token: AccessToken) => void = () => undefined
    const fetchAccessToken = vi
      .fn<() => Promise<AccessToken>>()
      .mockImplementationOnce(
        () =>
          new Promise<AccessToken>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(tokenExpiringIn(HOUR, 'user-b'))
    const manager = createTokenManager({ source: { fetchAccessToken }, now: () => NOW })

    const stale = manager.getAccessToken()
    manager.clear()
    resolveFirst(tokenExpiringIn(HOUR, 'user-a'))
    await stale

    expect(await manager.getAccessToken()).toBe('user-b')
    expect(fetchAccessToken).toHaveBeenCalledTimes(2)
  })
})
