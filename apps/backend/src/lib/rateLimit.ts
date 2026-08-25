/**
 * A fixed-window counter, in memory, per process.
 *
 * Extracted from the login route, which had the only copy. A second caller
 * (`POST /api/infrastructure/:id/outputs`) needed the same thing, and two
 * hand-rolled counters would drift on the first fix to either.
 *
 * **Per process.** With more than one backend instance behind a load balancer,
 * the effective cap is the configured one times the number of instances. That is
 * the accepted bound for both callers: for login it still turns an unlimited
 * guessing rate into a small multiple of ten per fifteen minutes, and for the
 * outputs refresh it turns an unbounded amplifier into a small multiple of one
 * request per cooldown. A shared store is the fix when either becomes the
 * binding constraint; it is not one today, and a Redis dependency for this would
 * be a bigger change than the problem.
 *
 * State is deliberately module-level rather than per-bucket-instance: a limiter
 * that resets when a module is re-imported is not a limiter.
 */

interface Attempt {
  count: number
  resetAt: number
}

/**
 * Hard cap on tracked keys so a flood of distinct clients cannot grow a map
 * without bound (memory-DoS). Once exceeded, the oldest entries are evicted.
 */
const MAX_KEYS = 10_000

export interface RateLimitBucket {
  /**
   * Count one attempt against `key` and report whether it is over the cap.
   *
   * Calling this IS the attempt: a caller that wants to test without consuming
   * budget wants a different function, and there is deliberately not one — every
   * call site so far is about to do the expensive thing.
   */
  isRateLimited(key: string): boolean
  /** Forget `key` entirely, e.g. after the attempt it was guarding succeeded. */
  reset(key: string): void
  /**
   * Forget every key.
   *
   * Exists for tests, which reuse database ids across cases and would otherwise
   * see one case's element throttle the next one's. Naming it plainly is better
   * than a test-only backdoor: an operator clearing a bucket after fixing
   * whatever caused a burst is a legitimate use of the same lever.
   */
  clear(): void
}

/**
 * @param max     attempts allowed inside one window
 * @param windowMs length of the window, in milliseconds
 */
export const createRateLimitBucket = (max: number, windowMs: number): RateLimitBucket => {
  const attempts = new Map<string, Attempt>()

  /**
   * Drop expired entries, then — if still over the cap — evict oldest first by
   * insertion order (Map preserves it) until back under it.
   */
  const prune = (now: number): void => {
    for (const [key, entry] of attempts) {
      if (entry.resetAt < now) attempts.delete(key)
    }
    if (attempts.size > MAX_KEYS) {
      // Computed once. Reading `attempts.size` inside the loop would compare
      // against a map that is shrinking as it goes, and stop about halfway.
      const overflow = attempts.size - MAX_KEYS
      let removed = 0
      for (const key of attempts.keys()) {
        attempts.delete(key)
        if (++removed >= overflow) break
      }
    }
  }

  return {
    isRateLimited(key: string): boolean {
      const now = Date.now()
      prune(now)
      const entry = attempts.get(key)
      if (!entry || entry.resetAt < now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs })
        return false
      }
      if (entry.count >= max) return true
      entry.count++
      return false
    },
    reset(key: string): void {
      attempts.delete(key)
    },
    clear(): void {
      attempts.clear()
    },
  }
}
