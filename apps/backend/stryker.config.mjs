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
  htmlReporter: { fileName: 'reports/mutation/backend.html' },

  // Was 1, on the belief that parallel workers would wipe each other's fixtures.
  // They do not: every Stryker worker runs in its own `.stryker-tmp/sandbox-*`
  // directory, and `src/test/database.ts` derives the database name from the
  // working directory — so each sandbox already had its own database. Four
  // workers, matching the suite's own `maxWorkers`, because they all queue on the
  // same Postgres past that point.
  concurrency: 4,

  // Default scope is the business logic in src/lib. The route handlers under
  // src/app/api are thin wrappers around these services; widen the run with
  // `pnpm test:mutation -- --mutate 'src/app/api/**/*.ts'` to cover them.
  mutate: [
    'src/lib/**/*.ts',
    '!src/lib/db/schema.ts', // table declarations — no behaviour to mutate
    '!src/lib/openapi/**', // spec plumbing, asserted by shape rather than behaviour
    '!src/**/*.test.ts',
  ],

  // A static mutant (module-level code, e.g. a zod schema built at import time)
  // cannot be attributed to individual tests, so Stryker reruns the whole suite
  // for each one — hours against a live database. They are reported as "ignored"
  // instead. Drop this once a full run is cheap enough to afford them.
  ignoreStatic: true,

  // Database round trips make individual tests slow enough that the default 5s
  // net timeout yields false "timeout" verdicts instead of real survivors.
  timeoutMS: 30000,
  timeoutFactor: 2,

  // 80 is the floor, and it fails the command rather than tutting at it (#127).
  // A score below this means behaviour nobody asserts, and the survivors list in
  // the HTML report is where to look — the number itself is only the alarm.
  thresholds: { high: 80, low: 60, break: null },
}

export default config
