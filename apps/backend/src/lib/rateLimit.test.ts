import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRateLimitBucket } from './rateLimit'

afterEach(() => {
  vi.useRealTimers()
})

describe('createRateLimitBucket', () => {
  it('allows exactly `max` attempts in a window, then limits', () => {
    const bucket = createRateLimitBucket(3, 60_000)

    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(true)
    expect(bucket.isRateLimited('k')).toBe(true)
  })

  it('keys are independent', () => {
    const bucket = createRateLimitBucket(1, 60_000)

    expect(bucket.isRateLimited('a')).toBe(false)
    expect(bucket.isRateLimited('a')).toBe(true)
    // Exhausting one key must not spend another's budget — that is the whole
    // point of a per-account bucket in the login route.
    expect(bucket.isRateLimited('b')).toBe(false)
  })

  it('starts a fresh window once the old one has expired', () => {
    vi.useFakeTimers()
    const bucket = createRateLimitBucket(1, 60_000)

    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(true)

    vi.advanceTimersByTime(60_001)

    expect(bucket.isRateLimited('k')).toBe(false)
  })

  it('does not reopen the window early', () => {
    vi.useFakeTimers()
    const bucket = createRateLimitBucket(1, 60_000)

    expect(bucket.isRateLimited('k')).toBe(false)
    vi.advanceTimersByTime(59_999)

    expect(bucket.isRateLimited('k')).toBe(true)
  })

  it('reset() forgets a key', () => {
    const bucket = createRateLimitBucket(1, 60_000)

    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(true)

    bucket.reset('k')

    expect(bucket.isRateLimited('k')).toBe(false)
  })

  // The memory-DoS guard: a flood of distinct keys must not grow the map
  // without bound. Eviction is oldest-first, so the newest keys — the ones an
  // attack is currently using — keep their counts.
  it('evicts oldest keys past the tracking cap, keeping the newest', () => {
    const bucket = createRateLimitBucket(1, 60_000)

    for (let i = 0; i < 10_050; i++) bucket.isRateLimited(`k${i}`)

    // The newest key is still tracked, so a second attempt on it is limited.
    expect(bucket.isRateLimited('k10049')).toBe(true)
    // An early key was evicted, so it gets a fresh budget. That is the accepted
    // trade: bounded memory costs an attacker-visible reset only after 10k
    // distinct keys, and the per-account bucket is what actually holds.
    expect(bucket.isRateLimited('k0')).toBe(false)
  })
})
