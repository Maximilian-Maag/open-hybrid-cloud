import { defineConfig } from 'vitest/config'

/**
 * The third vitest project: `scripts/`, which neither app collects (#377).
 *
 * Both app configs are rooted at their own package, so nothing under `scripts/`
 * was ever picked up — and `skip-budget.mjs` is a REQUIRED gate. The one piece
 * of code here with no coverage was the one deciding whether a green e2e run
 * means anything, which is how it shipped a false failure in #374 and, before
 * that, let #152's 283-skip run report success.
 *
 * `e2e/` stays out: those are Playwright specs and `playwright.config.ts` owns
 * them. Collecting them here would run them under the wrong runner and fail in
 * a way that says nothing.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
    /*
     * These spawn `node` per case rather than importing, so they are bounded by
     * process startup rather than by anything they compute. Generous anyway: a
     * shared runner that is busy should not turn into a red gate.
     */
    testTimeout: 20_000,
  },
})
