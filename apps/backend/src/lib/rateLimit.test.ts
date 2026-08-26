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

  // The boundary itself, which neither neighbouring test touches: the window is
  // [start, resetAt), so at exactly `resetAt` it is over. `<` kept a capped key
  // limited for that last millisecond.
  it('expires the window at exactly its reset time', () => {
    vi.useFakeTimers()
    const bucket = createRateLimitBucket(1, 60_000)

    expect(bucket.isRateLimited('k')).toBe(false)
    vi.advanceTimersByTime(60_000)

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

// The split `isRateLimited` used to refuse to have (#199): a caller that must
// decide between the check and the charge, because charging on the way in made
// a successful sign-in cost budget it never meant to spend.
describe('isOverLimit and count', () => {
  it('isOverLimit reports without consuming anything', () => {
    const bucket = createRateLimitBucket(2, 60_000)

    for (let i = 0; i < 20; i++) expect(bucket.isOverLimit('k')).toBe(false)

    // Twenty checks spent nothing, so the two attempts are still there.
    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(false)
    expect(bucket.isRateLimited('k')).toBe(true)
  })

  it('count charges without reporting', () => {
    const bucket = createRateLimitBucket(2, 60_000)

    bucket.count('k')
    expect(bucket.isOverLimit('k')).toBe(false)
    bucket.count('k')
    expect(bucket.isOverLimit('k')).toBe(true)
  })

  it('counts past the cap without climbing', () => {
    // The number is only ever compared against `max`. Letting it run would keep
    // a key limited long after its window should have moved on.
    vi.useFakeTimers()
    const bucket = createRateLimitBucket(2, 60_000)
    for (let i = 0; i < 50; i++) bucket.count('k')

    expect(bucket.isOverLimit('k')).toBe(true)
    vi.advanceTimersByTime(60_001)
    expect(bucket.isOverLimit('k')).toBe(false)
  })

  it('starts a fresh window for a key it has never seen', () => {
    const bucket = createRateLimitBucket(1, 60_000)
    bucket.count('fresh')
    expect(bucket.isOverLimit('fresh')).toBe(true)
    expect(bucket.isOverLimit('other')).toBe(false)
  })

  it('forgets a counted key on reset', () => {
    const bucket = createRateLimitBucket(1, 60_000)
    bucket.count('k')
    expect(bucket.isOverLimit('k')).toBe(true)

    bucket.reset('k')

    expect(bucket.isOverLimit('k')).toBe(false)
  })

  it('lets the window expire a counted key', () => {
    vi.useFakeTimers()
    const bucket = createRateLimitBucket(1, 60_000)
    bucket.count('k')
    expect(bucket.isOverLimit('k')).toBe(true)

    vi.advanceTimersByTime(60_001)

    expect(bucket.isOverLimit('k')).toBe(false)
  })
})
