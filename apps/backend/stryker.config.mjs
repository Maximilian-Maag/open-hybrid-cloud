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

  // Only our own TypeScript, and this is why the backend had no score at all.
  //
  // Stryker prepends `// @ts-nocheck` to every file it copies that its
  // `disableTypeChecks` glob matches — and the default reaches beyond `src`. It
  // was rewriting `public/swagger-ui/swagger-ui-bundle.js`, a VENDORED asset
  // committed so the docs page serves same-origin files, and
  // `api/docs/route.test.ts` compares that file byte-for-byte against the copy
  // in node_modules to catch a swagger-ui bump that skipped the vendoring
  // script. Sixteen bytes of banner, inserted after the license comment, and
  // the comparison was false:
  //
  //   repo    …LICENSE.txt */\n!function webpackUniversalModuleDefinition
  //   sandbox …LICENSE.txt */\n// @ts-nocheck\n\n!function webpackUniversal…
  //
  // One failed test in the dry run aborts the whole run — "There were failed
  // tests in the initial test run" — so every nightly since this test was
  // written died before mutating anything, and `thresholds.break` was enforcing
  // nothing at all. The test was right; the sandbox was lying to it.
  disableTypeChecks: 'src/**/*.{ts,tsx}',

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
  // minutes for the whole suite. Overrunning it fails the same silent way a
  // per-test timeout does: no mutants, no score, and a `thresholds.break` that
  // enforced nothing.
  //
  // Sixty, not the twenty this used to say. The old number was justified as
  // "far more than the ~1 minute CI has needed" — but that minute was the dry
  // run ABORTING on the swagger-ui test above, not completing. The first run
  // that actually finished took **17 minutes 39 seconds** for 3,167 tests, on
  // an idle 8-core machine; a shared runner is slower than that, and twenty
  // would have swapped one silent no-score failure for another.
  //
  // The job itself allows 330 minutes, so this costs nothing when it is not
  // needed. That is the point: this number exists to never be the reason there
  // is no score.
  dryRunTimeoutMinutes: 60,

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
  // `break` is 90 as well, by the owner's decision, taken with the gap in front
  // of them. So the nightly FAILS until the score gets there — that is deliberate
  // and it is the point: the run is a standing statement that the suite is not
  // yet where it is meant to be, rather than a green tick over 26 percent.
  //
  // What that costs, said plainly so nobody mistakes it for a regression: the
  // Mutation testing workflow is red every night until #245 closes. It is not a
  // pull-request check and blocks nothing; a red run there means "still climbing",
  // and the number in the job summary is the thing to read.
  //
  // The 90 that decides whether something ships is NOT this one. It lives in
  // .github/workflows/mutation-release-gate.yml, which measures staging -> main
  // and compares against its own RELEASE_THRESHOLD. Deliberate: #245 treats
  // `break` as a ratchet that follows the last measured score, and a release gate
  // reading a ratchet would pass whatever the suite happened to manage.
  //
  // Issue #245 tracks the climb and says where the points are — roughly two
  // thirds of the frontend gap is files with no test at all, not weak assertions.
  thresholds: { high: 90, low: 80, break: 90 },
}

export default config
