// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  // Declared explicitly: Stryker's default plugin glob ('@stryker-mutator/*')
  // does not follow the symlinks pnpm puts in node_modules, so autodiscovery
  // finds no test runner at all.
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/frontend.html' },

  // jsdom tests hold no shared state, so the default concurrency applies.
  // Everything under src is in scope: components and helpers without a test
  // file cost nothing to include (they are reported as "no coverage" without
  // running a single test) and they show where the suite has blind spots.
  mutate: [
    'src/**/*.{ts,tsx}',
    '!src/test/**', // setup only
    '!src/types/**', // type declarations
    '!src/**/*.test.{ts,tsx}',
  ],

  // `break: null` reports the score without failing the command. Set it once
  // the baseline score is known and you want CI to defend it.
  thresholds: { high: 80, low: 60, break: null },
}

export default config
