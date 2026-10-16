import { describe, expect, it } from 'vitest'
import { scrollTimeForNow } from './scrollTime'

describe('scrollTimeForNow', () => {
  it('är en hel timme före aktuell tid', () => {
    expect(scrollTimeForNow(new Date(2026, 9, 21, 14, 45))).toBe('13:00:00')
  })

  it('fyller ut med nolla på förmiddagen', () => {
    expect(scrollTimeForNow(new Date(2026, 9, 21, 9, 5))).toBe('08:00:00')
  })

  it('går inte under midnatt', () => {
    expect(scrollTimeForNow(new Date(2026, 9, 21, 0, 30))).toBe('00:00:00')
  })
})
