import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

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
 * runner process. An ordinary run keeps the strict 5s, because a test that
 * genuinely takes six seconds is worth being told about.
 */
const underMutationTesting = process.env.STRYKER_MUTATOR_WORKER !== undefined

export default defineConfig({
  plugins: [react()],
  test: {
    ...(underMutationTesting ? { testTimeout: 60_000, hookTimeout: 60_000 } : {}),
    globals: true,
    environment: 'jsdom',
    // Stryker copies the whole source tree into .stryker-tmp/sandbox-*/ while a
    // mutation run is in progress. Those copies contain test files, so an ordinary
    // `vitest run` picks them up: the suite doubles, and the copies fail against a
    // mutated source — which looks like a broken working tree.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
