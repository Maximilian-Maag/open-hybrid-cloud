/**
 * The budget a lock-synchronising spec waits on, and the per-test timeout that
 * has to be larger than it.
 *
 * Both live here because the bug they exist to prevent is that they disagree:
 * the wait was raised to 30s while `vitest.config.ts` killed the test at 15s,
 * so the raise did nothing and the diagnostic the wait exists to print became
 * unreachable (#386).
 *
 * `vitest.config.ts` deliberately does NOT import these. Its own timeout is a
 * default for three thousand ordinary tests and has nothing to say about a lock
 * wait; the four specs that wait on a lock override it per test with
 * `LOCK_TEST_TIMEOUT_MS`. That override is what makes the relationship correct,
 * and it makes it correct without the config and this file having to agree on a
 * number at all — which is a better guarantee than the one it replaces.
 *
 * It also keeps `process.env.STRYKER_MUTATOR_WORKER` out of `src/`, where the
 * policy gate reads every env access as an operator-facing setting that must be
 * documented in `.env.example`. Stryker sets that variable itself; documenting
 * it would be telling an operator to set something they must not.
 */

/**
 * How long a spec may wait for another backend to reach a blocking statement.
 *
 * Thirty seconds, and deliberately not a latency budget: the wait ends the
 * moment the lock is seen, so on an idle machine it costs milliseconds and the
 * ceiling is never approached. It is the point past which "the runner is busy"
 * stops being a possible explanation — and the three seconds this once allowed
 * was inside that, which is why CI failed these tests on a loaded runner with
 * "the confirmation never reached its UPDATE" while the code was perfectly fine.
 *
 * A generous ceiling costs a slow failure only when something is genuinely
 * broken. A tight one costs a red build on working code, which is worse: it
 * teaches everyone to re-run.
 */
export const BLOCKED_WAIT_MS = 30_000

/**
 * The per-test timeout a lock-synchronising spec needs, so `BLOCKED_WAIT_MS` is
 * actually reachable.
 *
 * A test vitest can kill before its own wait expires reports
 * `Test timed out in 15000ms` against the `it(...)` line, and that says neither
 * which synchronisation point hung nor whether the lock was ever taken. The
 * wait's own error says both, so the wait has to be able to win that race.
 *
 * Double the wait, which leaves a full thirty seconds for the rest of the test —
 * the fixtures, the key derivation and the transaction either side — and stays
 * at or above the 60s a mutation run grants, so applying it never LOWERS the
 * budget for the tests that can least afford it.
 *
 * Raising this rather than trimming the wait: the wait is the part that absorbs
 * a loaded runner, and shrinking it to fit would turn an occasional anonymous
 * timeout into a more frequent explicit one.
 */
export const LOCK_TEST_TIMEOUT_MS = BLOCKED_WAIT_MS * 2
