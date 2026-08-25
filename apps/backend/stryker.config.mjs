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

  // The DRY run is a different clock from `timeoutMS`, and its default is five
  // minutes for the whole suite. This suite is ~2,400 tests against a live
  // Postgres, instrumented — comfortably inside five minutes on an idle runner
  // and not on a busy one. Overrunning it fails the same silent way a per-test
  // timeout does: no mutants, no score, and a `thresholds.break` that enforced
  // nothing. Twenty minutes is far more than the ~1 minute CI has needed, which
  // is the point — this number exists to never be the reason there is no score.
  dryRunTimeoutMinutes: 20,

  // 80 is the floor, and it fails the command rather than tutting at it (#127).
  // A score below this means behaviour nobody asserts, and the survivors list in
  // the HTML report is where to look — the number itself is only the alarm.
  // 90 is the target the owner set, and it is a long way above where this stands
  // today: the frontend's last completed run scored 26.80 (54.69 over the code
  // its tests actually reach, with 4,470 mutants having no test near them at
  // all), and the backend has never produced a number because its nightly died
  // in the dry run — see the timeout notes above, which is what this branch
  // fixes.
  //
  // `break` is therefore NOT 90 yet, and setting it there today would only make
  // the nightly permanently red, which is the failure mode this repo already
  // names: a gate that starts red teaches people to ignore it. It is a ratchet
  // instead — `break` sits just under the last measured score, so the number can
  // only go up, and it is raised as tests land until it reaches `high`.
  //
  // Whoever raises it: run the nightly, take the reported score, and set `break`
  // to a point or two below it in the same PR that adds the tests. Issue #245
  // tracks the climb.
  //
  // The backend's `break` stays at 80 rather than dropping: nothing has measured
  // it, so there is no evidence it is too high, and lowering a threshold on a
  // guess is worse than finding out. The first green nightly sets it honestly.
  thresholds: { high: 90, low: 80, break: 80 },
}

export default config
