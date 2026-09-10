/**
 * Test timeouts, in one file because two of them have to agree.
 *
 * `vitest.config.ts` takes `TEST_TIMEOUT_MS`; the lock-synchronising specs take
 * `BLOCKED_WAIT_MS` and `LOCK_TEST_TIMEOUT_MS`. Keeping them apart is what went
 * wrong: the wait was raised to 30s while the timeout that kills the test
 * stayed at 15s, so the raise did nothing and the diagnostic the wait exists to
 * print became unreachable (#386).
 */

/**
 * Stryker wraps every expression in the source tree in a mutant switch, so the
 * same test is several times slower under a mutation run than under an ordinary
 * one. Vitest's default 5s per-test limit is generous for the second and not for
 * the first — and the failure is silent in the worst way: Stryker aborts its
 * DRY RUN with "There were failed tests in the initial test run", never mutates
 * anything, and reports no score. The nightly backend leg had been doing exactly
 * that, so `thresholds.break = 80` was enforcing nothing at all.
 *
 * Raised only under Stryker, which sets STRYKER_MUTATOR_WORKER in each test
 * runner process.
 */
const underMutationTesting = process.env.STRYKER_MUTATOR_WORKER !== undefined

/**
 * The per-test budget for an ordinary test.
 *
 * An ordinary run used to keep vitest's default 5s, on the argument that a test
 * genuinely taking six seconds is worth being told about. The argument is sound
 * and the number was not: this suite runs four workers against ONE Postgres, and
 * a budget of five seconds measures how busy that server is at least as much as
 * it measures the code.
 *
 * That is #282 — a full run reporting exactly one failure, a different test each
 * time, every one of them passing alone. The theory was a blocked TRUNCATE; the
 * diagnostic added to `src/test/setup.ts` disproves it, reporting an EMPTY
 * `pg_stat_activity` every time the reset ran slow. Nothing is holding a lock.
 * The server is simply saturated, and the tests that lose are whichever ones
 * happened to be doing the most I/O at the time.
 *
 * 15s, then. Still tight enough to catch a test that has genuinely gone wrong —
 * nothing here does real work for fifteen seconds — and slack enough that a
 * queue on a shared server is not reported as a failing assertion.
 */
export const TEST_TIMEOUT_MS = underMutationTesting ? 60_000 : 15_000

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
 * A test that vitest can kill before its own wait expires reports
 * `Test timed out in 15000ms` against the `it(...)` line, and that says neither
 * which of the synchronisation points hung nor whether the lock was ever taken.
 * The wait's own error says both. So the wait has to be able to win that race,
 * which means the timeout must sit above it with room for the rest of the test —
 * the fixtures, the key derivation and the transaction either side.
 *
 * Raising the timeout rather than shrinking the wait, because the wait is the
 * part that absorbs a loaded runner. Trimming it to fit 15s would turn an
 * occasional anonymous timeout into a more frequent explicit one, which is the
 * opposite of what #386 is for.
 *
 * `max` rather than a bare sum: a mutation run's 60s is already larger, and a
 * per-test timeout would otherwise LOWER it for exactly the tests that can
 * least afford it.
 */
export const LOCK_TEST_TIMEOUT_MS = Math.max(TEST_TIMEOUT_MS, BLOCKED_WAIT_MS + 15_000)
