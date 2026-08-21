# Mutation Testing Guide

Line coverage says a line ran; it does not say an assertion would notice if that
line were wrong. [StrykerJS](https://stryker-mutator.io/) answers the second
question: it rewrites the source one small change at a time (`>` → `>=`, `&&` →
`||`, a string literal → `""`) and reruns the tests that cover that line. A
mutant the suite still passes on — a **survivor** — marks behaviour nothing
asserts.

Both apps are wired up:

```bash
pnpm --filter frontend test:mutation     # jsdom suite, minutes
pnpm --filter backend  test:mutation     # real Postgres, hours — see below
pnpm test:mutation                       # both, backend first
```

Reports land in `apps/<app>/reports/mutation/<app>.html` (git-ignored). Open one
and read the survivors; the score itself matters less than the list.

Narrow a run to what you are working on — this is the normal way to use the tool:

```bash
pnpm --filter backend test:mutation -- --mutate 'src/lib/services/orders.ts'
pnpm --filter frontend test:mutation -- --mutate 'src/components/forms/**/*.tsx'
```

---

## Prerequisites

The backend suite talks to a real database, so the same prerequisite as
`pnpm --filter backend test` applies: Postgres up (`make dev` or the compose
file in `infra/docker-host/`) with the `open_hybrid_cloud_test` database
present. A mutation run starts with an unmutated dry run and aborts on the first
failure, so a suite that is red for unrelated reasons stops Stryker before it
mutates anything.

A backend run also needs the test database **to itself**. Anything else that
runs the suite at the same time — a second terminal, another agent, an editor
test runner — truncates the tables Stryker's run is mid-way through using, and
the run dies on a `TRUNCATE TABLE ...` failure in the dry run that looks like a
config problem but is not.

Expect it to be slow. One measured data point: mutating
`src/lib/tfparser/index.ts` alone (116 mutants, ~4 covering tests each) takes
**12m40s**, because every mutant reruns DB-backed route tests at roughly 6s a
piece. Scoping the run with `--mutate` is the difference between a coffee break
and an overnight job. The frontend is a different animal entirely: 130 mutants
in `src/lib/contrast.ts` finish in 70 seconds.

---

## Why the two configs differ

`apps/frontend/stryker.config.mjs` is close to stock. The jsdom tests share no
state, so Stryker runs its default number of workers, and everything under `src`
is in scope: a component with no test costs nothing to include, because a mutant
no test covers is reported as "no coverage" without running anything.

`apps/backend/stryker.config.mjs` carries three deliberate deviations:

- **`concurrency: 1`.** Every test file truncates every table in `beforeEach`
  against the one `open_hybrid_cloud_test` database. Two Stryker workers would
  wipe each other's fixtures mid-test and report the wreckage as killed mutants.
- **`ignoreStatic: true`.** A mutant in module-level code (a zod schema built at
  import time, a top-level constant) cannot be attributed to any single test, so
  Stryker falls back to running the *entire* suite for it — hours per mutant
  here. Those mutants are reported as "ignored" instead of measured.
- **`mutate` scoped to `src/lib/**`.** The service layer is where the logic
  lives; the route handlers in `src/app/api` are mostly wrappers around it. Add
  them explicitly (`--mutate 'src/app/api/**/*.ts'`) when you want them checked.

Both configs also name the plugin explicitly:

```js
plugins: ['@stryker-mutator/vitest-runner'],
```

Stryker's default plugin glob (`@stryker-mutator/*`) does not follow the
symlinks pnpm puts in `node_modules`, so without this line it finds no test
runner at all and fails with `Cannot find TestRunner plugin "vitest"`.

---

## Making the backend run faster

`concurrency: 1` is what makes a full backend run an overnight job rather than a
coffee break. The way out is to stop sharing one database: Stryker sets
`STRYKER_MUTATOR_WORKER` (`0`, `1`, `2`, …) in each test-runner process, so
`vitest.config.ts` can derive a per-worker database name from it and
`src/test/setup.ts` can create that database on first use. With that in place
`concurrency` can go up to the core count. Until then, prefer scoped runs with
`--mutate`.

---

## Not in CI

Neither app runs mutation testing in `.github/workflows/ci.yml`, on purpose: a
per-PR mutation run is far too slow to gate a merge on. Run it locally when you
touch logic you care about, or wire it into a scheduled workflow if the score
becomes something the team wants to defend. `thresholds.break` is `null` in both
configs, so the command reports the score without failing; set it once a
baseline is agreed.
