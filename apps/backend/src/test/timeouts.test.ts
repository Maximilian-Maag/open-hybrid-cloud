import { describe, it, expect } from 'vitest'
import { BLOCKED_WAIT_MS, LOCK_TEST_TIMEOUT_MS } from './timeouts'

/*
 * The invariant, asserted, because the bug it guards against is invisible.
 *
 * #386 was a 30s wait under a 15s timeout: nothing failed to compile, no test
 * turned red on purpose, and the only symptom was that a DIFFERENT error
 * message printed when a lock-synchronising test lost. Raising one number
 * without the other is the exact mistake, and it is the kind a reviewer reads
 * straight past — so it is worth a test rather than a comment.
 */
describe('lock-synchronising test timeouts', () => {
  it('lets a lock wait finish before vitest kills the test', () => {
    expect(LOCK_TEST_TIMEOUT_MS).toBeGreaterThan(BLOCKED_WAIT_MS)
  })

  it('leaves room for the rest of the test around the wait', () => {
    // Fixtures, key derivation and the transaction either side of the wait.
    expect(LOCK_TEST_TIMEOUT_MS - BLOCKED_WAIT_MS).toBeGreaterThanOrEqual(10_000)
  })

  /*
   * A mutation run raises vitest's own timeout to 60s. A per-test override
   * REPLACES that rather than extending it, so an override below 60s would
   * quietly shorten exactly the tests Stryker makes slowest.
   */
  it('never lowers the budget a mutation run grants', () => {
    expect(LOCK_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})
