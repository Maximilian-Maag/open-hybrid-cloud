# Codebase Audit — 2026-08-12

Full audit of the monorepo (backend Next.js API, frontend, shared types, infra).
Baseline before changes: typecheck ✅, lint ✅, 719 backend + 20 frontend tests ✅.
After changes: typecheck ✅, lint ✅, **722 backend + 20 frontend tests ✅**.

The fixes below are applied on this branch. The "Deferred" section lists confirmed
findings that need a product/architecture decision or cannot be safely verified
without a live external system (GitHub/Entra), and so were intentionally not
changed blind.

---

## Fixed on this branch

### Security

1. **GitHub & Bitbucket callbacks verified the wrong secret** — both routes
   computed the inbound HMAC against `webhook_token` (the *outbound* trigger
   token) instead of `callback_secret`. GitLab was already migrated (0004).
   The moment an operator rotates the two apart, every GitHub/Bitbucket callback
   would 401 (orders never complete), and the outbound token — which is readable
   by any admin and shared to the CI system — could forge callbacks. Now both
   validate against `callback_secret`, matching GitLab.
   *Files:* `webhooks/github/workflow/route.ts`, `webhooks/bitbucket/pipeline/route.ts`.
   *Regression tests added* (distinct outbound/inbound secrets).

2. **`JWT_SECRET` silently fell back to `''`** — with no secret set, tokens were
   signed/verified with an empty key, letting anyone mint a `root` session.
   Now fails fast at module load if the secret is missing or < 32 chars, and
   `verifyToken` pins `algorithms: ['HS256']`.
   *File:* `lib/auth/jwt.ts`.

3. **Audit export was broken and leaked the token** — the frontend opened the
   export via `window.open(...&token=…)`, but the endpoint only authenticates via
   the `Authorization` header, so every export 401'd; the token was also placed
   in the URL (history/Referer/logs). Now fetched with the header and downloaded
   from the response blob.
   *File:* `audit/AuditTable.tsx`.

4. **CSV formula injection in audit export** — cells beginning with `= + - @`
   (tab/CR) are executed as formulas by Excel/Sheets. Audit fields capture
   user-supplied values. Such cells are now prefixed with `'`.
   *File:* `audit/export/route.ts`. *Regression test added.*

5. **Email header hardening** — subjects were HTML-escaped (wrong for plain-text
   subjects → double-escaped names) and relied on escaping for header safety.
   Subjects now use the raw product name with CR/LF stripped.
   *File:* `lib/notification/index.ts`.

### Correctness

6. **Race conditions in approve / reject / decommission** — all three read the
   row, checked its status, then triggered pipelines and updated non-atomically.
   Two concurrent calls (or a double-click) could both pass the check and
   double-provision / double-destroy, or leave an active infra element attached
   to a rejected order. Each now claims the row with a conditional
   `UPDATE … WHERE status = <expected> RETURNING` and rolls back on trigger
   failure, so only one caller can win the transition.
   *Files:* `services/approvals.ts`, `services/infrastructure.ts`.

7. **SMTP config changes never took effect** — the transporter/settings were
   cached at module scope and never invalidated, so admin-UI SMTP edits were
   ignored until restart. Added `resetSmtpCache()`, called on SMTP config update.
   *Files:* `lib/notification/index.ts`, `services/admin/config.ts`.

8. **AI endpoint default ignored the provider and blank values** — a blank
   endpoint (which the UI explicitly allows) never fell back because the column
   is a non-null `''`, and the single hardcoded default was an OpenAI host even
   for Claude. Blank now normalizes to a per-provider default, and a malformed
   AI JSON response throws a clear error instead of a raw `JSON.parse` crash.
   *File:* `lib/ai/index.ts`.

9. **AI-translate errors were swallowed in the UI** — the handler had an empty
   `catch`, so a failed translation silently stopped the spinner. Errors are now
   surfaced in a banner.
   *File:* `admin/products/[id]/ProductEditForm.tsx`.

10. **Decommission confirmation warning only shown in English** — a hardcoded
    English string replaced the existing localized `cannotBeUndone` key.
    *File:* `infrastructure/InfraActions.tsx`.

11. **Root `.env.example` was stale and misleading** — wrong var names
    (`SESSION_SECRET`, `ENTRA_REDIRECT_URL`, `SMTP_USERNAME/PASSWORD`), unused
    vars, missing required vars (`JWT_SECRET`, `FRONTEND_URL`, `NEXTAUTH_SECRET`,
    `API_URL`, `NEXT_PUBLIC_API_URL`), and a DB name that didn't match compose.
    Rewritten to match the code.
    *File:* `.env.example`.

---

## Deferred — confirmed findings needing a decision (not changed)

- **GitHub-backed orders never complete (HIGH).** `triggerGitHubWorkflow` returns
  a synthetic id `owner/repo/workflow@branch` (workflow_dispatch has no run id),
  but the callback stores the numeric `workflow_run.id`. They can never match in
  `handlePipelineEvent`, so GitHub orders stay `provisioning` forever. Proper fix
  requires correlating on a unique dispatch input (e.g. `ORDER_ID` echoed into
  the run) and can't be verified without a live GitHub — needs design + real
  testing. *File:* `lib/ci/github.ts`, `webhook/handler.ts`.

- **Multi-pipeline orders complete on the first success (HIGH).**
  `handlePipelineEvent` completes an order as soon as *any* pipeline in its array
  succeeds; a later failure is dropped. Needs per-pipeline status tracking.
  *File:* `lib/webhook/handler.ts`.

- **`createOrder` does no server-side parameter validation (MEDIUM).** Required
  params aren't enforced and types aren't coerced/validated against the
  `parameters` table before an order is accepted and sent to provisioning.
  *File:* `services/orders.ts`.

- **`createOrder` has no project-ownership check (MEDIUM / IDOR).** A PM can
  submit an order against another PM's `projectId`; the resulting infra element
  (and cost) is attributed to — and manageable by — the other owner. Needs an
  ownership check for non-admins. *File:* `services/orders.ts`.

- **Cascade delete races with in-flight destroy (MEDIUM).** `deleteProject` /
  `deleteProduct` fire-and-forget the destroy webhook then immediately delete the
  rows (`ON DELETE CASCADE`), losing tracking of the running decommission.
  *Files:* `services/projects.ts`, `services/admin/products.ts`.

- **Drizzle meta snapshots for migrations 0002–0004 are missing (HIGH for
  `db:generate`).** `meta/_journal.json` lists five migrations but only 0000/0001
  snapshots exist, and 0001 is stale. The runtime migrator is unaffected, but the
  next `drizzle-kit generate` will fail or emit a corrupt duplicate migration.
  Regenerate the snapshots with `drizzle-kit`. *Dir:* `drizzle/meta/`.

- **OAuth login flow (LOW–MEDIUM).** The Entra `id_token` is decoded but not
  verified (no JWKS/`aud`/`iss`), there's no `state`/`nonce` (login-CSRF), and
  the session JWT is delivered as a URL query param. Needs an auth-flow rework.
  *File:* `auth/callback/route.ts`.

- **Login rate-limit is bypassable (MEDIUM).** Keyed on the spoofable
  `X-Forwarded-For`; the in-memory bucket is also unbounded. Derive the IP from
  the trusted proxy hop and bound the map. *File:* `auth/login/route.ts`.

- **No pagination on CI provider listings (MEDIUM).** GitLab/GitHub/Bitbucket
  repo/branch/file listings cap at 100 with no cursor follow, silently
  truncating large orgs. *Files:* `lib/ci/{gitlab,github,bitbucket}.ts`.

- **Test-setup schema drift (LOW–MEDIUM).** `src/test/setup.ts` gives
  `callback_secret`/`exchange_rates.rate` defaults prod lacks, and branding color
  defaults that differ from `schema.ts`. No live bug today (all insert paths
  supply the values), but it weakens the suite's ability to catch future prod
  drift. The branding default mismatch also needs a decision on the canonical
  color. *File:* `src/test/setup.ts`.
