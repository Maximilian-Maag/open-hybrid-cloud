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
    // The 25 language tables are ~5,000 module-level string literals. Mutating one
    // asks "would a test notice if this German label changed", and the answer is no
    // by design: nothing asserts individual translations, only that a language does
    // not fall back to English wholesale. Including them cost more than half the
    // run's mutants for no signal — a full run was estimated at 38 hours, 97% of it
    // on these.
    '!src/lib/i18n.ts',
  ],

  // Static mutants — code that runs once at import time — cannot be attributed to
  // individual tests, so Stryker reruns the whole suite for each one. Measured on
  // this app: 51% of mutants were static and accounted for an estimated 97% of the
  // runtime. Reported as "ignored" instead, the same call the backend config
  // already made. The cost is real: module-level constants and configuration
  // objects are no longer covered by the score.
  ignoreStatic: true,

  // The dry run is its own clock, defaulting to five minutes for the whole
  // suite. The frontend's takes ~50 seconds, so this is headroom rather than a
  // fix — but overrunning it produces no score at all, silently, and a gate that
  // can vanish without saying so is worth one line to prevent.
  dryRunTimeoutMinutes: 20,

  // 80 is the floor, and it fails the command rather than tutting at it (#127).
  //
  // Note what this is measured over: `mutate` below deliberately includes files
  // with no test at all, so they show up as blind spots. They score zero and they
  // drag this number down — which is the intended pressure, but it means a low
  // score here can mean "untested file added" rather than "assertions got worse".
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
  thresholds: { high: 90, low: 80, break: 25 },
}

export default config
