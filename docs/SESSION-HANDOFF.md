# Session handoff — 2026-09-01 / 09-03

A working note, not documentation. It is tracked because it was swept into a
commit long before this session; delete it when the queue below is empty.

## Where things stand

**Merged this session** (all into `dev`, all squashed):

| PR | What it was |
|---|---|
| #285 | CI seeds the e2e database; a run that skips its way to green now fails |
| #306 | the a11y focus probe measured existence, not visibility |
| #310 | a test database with a schema and no journal was unusable for ever |
| #311 | #195 findings 9 + 10 — the integrations table could hold a state its own code forbids |
| #315 | #312 a disabled product could not be deleted · #313 the product page's parameter editor had no T-shirt size |
| #316 | #314 the orders list can be refreshed, and waiting pages refresh themselves |
| #318 | #317 SMTP could be set and never unset, and the e2e test hid it by leaking |
| #319 | #195 finding 10 — the endpoints that set prices wrote no audit entry |
| #320 | #223 the five detail pages were scanned and the gate could not tell |

**Open, and the only thing in flight:**

### PR #322 — `feat(#157)`: the provisioning webhook now has an e2e test

Auto-merge is armed. It is BLOCKED only on CI.

What it does: starts the WireMock from `infra/wiremock/mappings` in the e2e job
(as a `docker run` step — service containers start before the checkout, and the
mappings are the point), adds `DEMO_CI_URL` which points the demo catalogue at
it, and seeds a **pipeline stack** when that variable is set. `e2e/provisioning.
spec.ts` then walks the whole path with nothing mocked: order → real HTTP
trigger → callback on the public webhook route with the environment's real
callback secret → `completed` → an element carrying the Terraform outputs parsed
out of the child pipeline's apply job.

**Verified locally** against a fresh database and the local WireMock:
`outputs: { vm_ip: '10.0.0.100', vm_name: 'dev-server-01', disk_size_gb: '50' }`.

**What CI has to answer, and the first thing to look at when you come back:**
the seven tests that skip for want of a pipeline stack should now RUN —
`order-flow` "can submit an order", two `cart` tests, `approvals`,
`admin-pipeline-stacks`, two `admin-products`. I could not get a clean local run
of all of them together (see "this machine" below). If any fail, that is a real
finding this PR surfaced rather than caused, and it belongs to #296.

**The skip budget in `ci.yml` is still 8, deliberately.** Lower it once CI says
what the number actually is. Guessing it down fails the run for the wrong reason.

## The queue, in the order I would take it

1. **Watch #322 through CI** and lower the skip budget to whatever the run
   reports. Then #296 for whatever still skips or fails.
2. **#195 findings 7 and 8** — the two remaining backend races. 7: the
   completion CAS in `webhook/settle.ts` guards `status` but not the
   `pipeline_status` snapshot the decision was made on. 8:
   `deleteProductEnvironment` strands live infrastructure and drops its orders
   from the cost report. Both are written up in the issue with the fix.
3. **#195 frontend items F1–F5** — small and independent. F4 in particular: a
   root account with zero recovery codes is told to "save these now", in 25
   locales, at the one moment the message has to be right.
4. **#245** raise the mutation score. **#298** findings 2 and 3 (the selection
   assertion is hard-coded to the top nav; the language sweep covers three
   elements on one page).
5. Then the large integrations: #108–#117, #148, #197, #241.

## Things that will bite you

**This machine cannot run the full e2e suite.** A long Playwright run degrades
`next dev` until navigation exceeds 30 s, and then the server dies —
`ERR_CONNECTION_REFUSED` and `__webpack_modules__[moduleId] is not a function`.
A full `a11y.spec.ts` run ended 43 failed / 42 passed for exactly that reason
while every targeted run of the same tests was green. **Per-spec runs are the
only valid local signal; CI is the arbiter.**

**Local e2e database.** `open_hybrid_cloud_e2e_local` exists and is seeded with
`DEMO_CI_URL=http://localhost:8080`, including the pipeline stack. To use it:

```sh
BASE=$(grep -oP '^DATABASE_URL=\K.*' apps/backend/.env)
E2EDB=$(echo "$BASE" | sed 's|/[^/]*$|/open_hybrid_cloud_e2e_local|')
DATABASE_URL="$E2EDB" DEMO_CI_URL=http://localhost:8080 \
  E2E_ADMIN_EMAIL=root@test.dev E2E_ADMIN_PASSWORD=testpassword123 \
  npx playwright test e2e/provisioning.spec.ts --reporter=line
```

`ohc-wiremock` is already running on :8080 from `infra/docker-compose.dev.yml`.

**`e2e/.auth` and TOTP.** The secret is derived from `JWT_SECRET`, and only one
checkout can hold an enrolment against a given database at a time. When
auth.setup fails with "the account already has an authenticator this run did not
enrol", clear the one enrolment and the cached session:

```bash
# Named in full on purpose. An unscoped `delete from user_totp` against the URL
# in apps/backend/.env unenrols every account on the DEV database, which is not
# this one, and the next person to sign in there has to re-pair.
psql "$E2EDB" -c "select current_database()"   # must print open_hybrid_cloud_e2e_local
psql "$E2EDB" -c "delete from user_totp where user_id = (select id from users where email = 'root@test.dev')"
rm -rf e2e/.auth
```

**`JWT_SECRET` was rotated** in `apps/backend/.env` this session (it was 23
characters, under the 32 the server requires, so every local login failed).
`user_totp` was cleared to match. The dev SERVER is untouched.

**pnpm wanted to purge `node_modules`.** `node_modules/.modules.yaml` in the
main checkout had `virtualStoreDir` pointing at the `e2e152` worktree — copied
in by an install run from the wrong cwd. Fixed by setting it back to `.pnpm`;
no reinstall was needed. If `pnpm dev` ever aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, check that field first.

**328 test databases**, about 3 GB, are still on the local Postgres. #310 shipped
`pnpm --filter backend test:db:prune` (lists by default, drops with `--yes`,
skips anything a running suite holds). **I did not run it.**

## Two review lessons worth keeping

CodeRabbit was right twice, and both were real:

* the hydration marker was set once and never cleared, so waiting for it after a
  client-side navigation established nothing — worse than not waiting, because
  it reads as a guarantee. Fixed by stamping the pathname alongside it.
* the focus probe ignored alpha, so `rgba(0,0,0,0.05)` measured 21:1 against
  white. The backdrop had the mirror bug — first ancestor with `alpha > 0.5`
  taken as opaque, so a 60 % overlay on a dark page read as white and a white
  ring on it as 1.00. Both composited now.

**`required_conversation_resolution` is on for `dev`.** A PR with all checks
green still shows BLOCKED while any review thread is unresolved. Resolve them
with the GraphQL `resolveReviewThread` mutation after answering.
