# Test Plan & Recommendations — 2026-08-12

Recommended tests across the three levels. Snapshots below are the **pre-audit
baseline** that motivated this plan; the **current** column reflects what this PR
has since implemented.

| Level | Pre-audit baseline | Current (this PR) |
|-------|--------------------|-------------------|
| Backend unit/integration (`apps/backend`, vitest + real Postgres) | 94 files / ~719 tests — **strong** | **747 tests** |
| Frontend unit/component (`apps/frontend`, vitest + jsdom + Testing Library) | 2 files / ~20 tests — **major gap** (no component/form/hook tests) | **53 tests / 11 files** (UI primitives, StatusBadge, AuditTable, i18n, locale added) |
| E2E (`e2e`, Playwright, single worker) | 24 specs — **broad** | 24 specs (unchanged) |

Legend: **[NEW]** no coverage at audit time · **[EXT]** extend an existing test ·
**✅ DONE** implemented in this PR.

---

## 1. Backend — unit & integration (`*.test.ts` beside source, real DB)

The route/service layer is well covered. Priorities are the newly-fixed logic and
untested edge cases.

### Regression tests for fixes on this branch (highest priority)
- **createOrder validation** (`services/orders.test.ts` [EXT]): missing required
  param → 400; wrong type (number/bool/dropdown) → 400; optional-param default
  applied; happy path unaffected.
- **createOrder ownership/IDOR** (`services/orders.test.ts` [EXT]): PM ordering
  into another PM's project → 403; product not offered in chosen environment →
  400; admin can order into any project.
- **Multi-pipeline completion** (`lib/webhook/handler.test.ts` [EXT]): order with
  pipelines `[A,B]` stays `provisioning` after A succeeds, `completed` only after
  both, `failed` if B fails after A succeeded; single-pipeline behavior unchanged.
- **Login rate-limit** (`app/api/auth/login/route.test.ts` [EXT]): rotating a
  spoofed `X-Forwarded-For` does NOT reset the bucket when `TRUST_PROXY` is unset;
  limiter still triggers after N attempts; map does not grow unbounded.
- **CI pagination** (`lib/ci/gitlab.test.ts`, `github.test.ts`, `bitbucket.test.ts`
  [EXT]): msw serves 2+ pages (Link/X-Next-Page/`next`); results concatenated;
  page cap respected.
- **Cascade-delete ordering** (`services/projects.test.ts`,
  `services/admin/products.test.ts` [EXT]): destroy trigger is awaited/dispatched
  before the row (and its cascaded infra) is deleted.
- **Callback secret** (already added): github/bitbucket verify against
  `callback_secret` not `webhook_token`.
- **CSV formula injection** (already added) and **JWT fail-fast** — add a JWT test
  in a separate module context asserting a `<32`-char secret throws at import.

### Coverage gaps in existing behavior
- **Concurrency / atomic transitions** (`services/approvals.test.ts`,
  `infrastructure.test.ts` [NEW cases]): fire two `approveOrder`/`decommissionInfra`
  calls with `Promise.all` on the same row and assert exactly one provisions /
  one infra element is created (guards the conditional-UPDATE fixes).
- **Exchange-rate conversion** (`lib/exchange/index.test.ts` [NEW]): rate
  direction, missing rate, non-EUR→non-EUR, rounding; and `refreshRates` upsert.
- **PDF/CSV audit export** (`app/api/audit/export/route.test.ts` [EXT]): PDF is a
  non-empty valid buffer; CSV quoting for embedded commas/quotes/newlines; filter
  params (userId/action/from/to) shape the result set.
- **AI translate** (`lib/ai/index.test.ts` [NEW]): provider routing
  (claude/openai/azure/ollama), per-provider default endpoint, markdown-fence
  stripping, malformed-JSON → clear error (msw-mocked provider).
- **Notification** (`lib/notification/index.test.ts` [EXT]): `resetSmtpCache`
  causes the next send to re-read config; subject strips CR/LF; env config takes
  precedence over DB config.
- **Webhook signature edge cases** (`webhooks/*/route.test.ts` [EXT]): missing
  signature header, malformed signature, length-mismatch (timingSafeEqual guard),
  unknown-environment secret → 401.
- **Health/readiness** (`app/api/health/route.test.ts` [EXT]): DB-down path
  returns a degraded status rather than 200.

---

## 2. Frontend — unit & component (vitest + jsdom + Testing Library) — BIGGEST GAP

Almost nothing is tested. Establish component testing with a small render helper
(wrap in `ToastProvider`, provide a `lang`) and mock `@/lib/api`.

### UI primitives (`components/ui/*.test.tsx`) — ✅ DONE in this PR
- **Input / Select** ✅: label↔control linkage; `aria-invalid` + `aria-describedby`
  set when `error`; required asterisk.
- **Modal** ✅: `aria-labelledby` matches the title; `ariaLabel` names a title-less
  dialog; labeled close button. (Escape/backdrop `onClose` still worth adding.)
- **Table** ✅: renders headers with `scope="col"`; empty-state message;
  `onRowClick` fires on click.
- **Toast** ✅: error toast uses `role="alert"`, success uses `role="status"`.
- **StatusBadge** ✅: renders the localized label for each status in a non-English
  `lang`; unknown status falls back to the raw value.

### Forms (`components/forms/*.test.tsx` [NEW]) — highest business value
- **OrderForm**: client-side validation blocks submit when required params empty;
  builds the correct payload; shows success and error states; price displayed in
  the active locale; no double-submit while loading.
- **ParameterFields**: controlled inputs for string/number/bool/dropdown; no
  keystroke loss / infinite render (guards the documented prior bug); `sensitive`
  masking.

### Managers & flows (`app/(dashboard)/**/*.test.tsx` [NEW])
- **Admin managers** (cost-centers as the template, then parameters/ci-sources/
  users/categories): create/edit/delete happy paths; **delete failure surfaces an
  error and the modal doesn't get stuck** (guards the silent-failure fixes);
  load failure shows an error, not an empty state; toggle-active failure surfaces.
- **ProductEditForm**: false-"Saved!" regression — a failed per-env save shows an
  error, not a success badge; AI-translate error surfaces; webhook/stack/param
  delete failures surface.
- **AuditTable** ✅ (debounce): text filters are debounced (one request after
  rapid typing). Still worth adding: assert the export uses a header-authenticated
  fetch + blob download (not `window.open` with a token in the URL).

### Lib/hooks (`lib/*.test.ts`)
- **i18n** (`lib/i18n.test.ts`) ✅: sample key present in all 25 languages; status
  keys present in all languages; `t()` falls back to `en` for an unknown lang;
  region-subtag normalization.
- **locale** (`lib/locale.test.ts`) ✅: `convertPrice` rate math + locale
  formatting (`1.234,50` for `de`, `1,234.50` for `en`, incl. same-currency);
  `localeToCurrency` map.
- **useLang / getLang** (`lib/*.test.ts` [NEW], still recommended): cookie →
  `accept-language` → `en` precedence; `langchange` event updates the hook.

---

## 3. E2E (Playwright) — extend the existing 24 specs

Coverage is broad; add the flows the fixes introduced and cross-cutting concerns.

- **Full order lifecycle** (`order-flow.spec.ts` [EXT]): order → approve →
  simulate pipeline callback (POST the webhook with the callback secret) → assert
  order `completed` and an infrastructure element appears; then decommission →
  callback → `decommissioned`. Covers the multi-pipeline + callback-secret fixes
  end to end.
- **Order validation** ([NEW] `order-validation.spec.ts`): submitting with a
  required parameter empty shows a validation error and does not create an order.
- **Authorization** (`roles.spec.ts` — DONE, planned here as `authz.spec.ts`): a
  permission matrix asserted as each role, in three parts — every endpoint's
  guard (allowed vs. 403), every page the role's nav offers rendering its own
  data, and a page above the role not handing that data over. A project_manager
  reading another PM's order is covered in `processes.spec.ts`.

  Two notes for anyone extending it. The table is written as the set of roles
  that ARE allowed, not as a minimum rank, because one endpoint needs "admin but
  not root": `listDelegations` refuses root in the SERVICE, since the route's
  `requireRole('admin')` admits it by rank and root does not participate in
  approval delegation. And the accounts are created at run time through the API
  rather than seeded — a seeded second user was the plan below, but it cannot
  cover an admin, whose session only works after the mandatory second-factor
  enrolment (#197) that `signInAsAccount` walks.

  This is the coverage whose absence let #323 ship: the catalogue asked a
  root-only route for the category filter, so the shop was an error page for
  every role except the one the whole suite signs in as.
- **Process journeys** (`processes.spec.ts` — DONE): the flows that cross
  accounts, which no single-session spec can see — a project_manager orders and
  the order WAITS, the orderer cannot approve their own order, an admin finds it
  in the queue and rejects it with a note the orderer can read, root retires a
  product and it leaves the shop, root deactivates an account and it can no
  longer sign in. The post-approval half (CI fired, callback, element active)
  needs a CI endpoint the suite can answer for and lives in `provisioning.spec.ts`
  (#157).
- **Localization** ([NEW] `i18n.spec.ts`): switch language via the switcher →
  `<html lang>` updates, nav/status labels change, cookie persists across reload;
  dates/prices render in the selected locale.
- **Accessibility smoke** ([NEW] `a11y.spec.ts`): run `@axe-core/playwright` on
  catalog, order form, a modal (open state), and an admin manager; assert no
  serious/critical violations. Keyboard-only: skip link focuses `#main`; modal
  traps focus and closes on Escape.
- **Audit export** (`audit.spec.ts` [EXT]): clicking Export CSV/PDF downloads a
  file (assert the download event), not a JSON 401 page.
- **Error/empty states** ([NEW]): with the backend stopped, a list page shows the
  error boundary, not a misleading empty state.
- **SMTP/AI config** (`admin-config.spec.ts` [EXT]): saving SMTP config takes
  effect immediately (send a test mail via Mailpit and assert receipt).

### E2E infrastructure notes
- ~~Add a non-root seeded user + a second storage state so authorization specs
  can run as a project_manager.~~ Done differently, and deliberately:
  `helpers.ts` creates each role's account through the API at run time and signs
  it in from a context with NO stored state. A seeded user and a saved storage
  state would have been cheaper for a project_manager and no help at all for an
  admin — a fresh administrative account owes a second factor before its session
  can reach anything, so the enrolment has to be walked, and a storage state
  saved once would go stale against a database that is reseeded per run.
- The dev stack already mocks CI (WireMock) and SMTP (Mailpit) — assert against
  Mailpit's API for email flows and WireMock for CI triggers.

---

## 4. Cross-cutting / CI

- **Coverage gates**: `test:coverage` exists for both apps; add a CI threshold
  (start low for frontend, e.g. 40%, and ratchet up) so the frontend gap can't
  silently regress.
- **CI already runs** typecheck, lint, unit/integration (with a Postgres service)
  and e2e — ensure new frontend component tests run in the same `test` job.
- **Contract tests**: the shared `@open-hybrid-cloud/types` package is the
  frontend/backend contract; consider a lightweight test asserting a sample of API
  responses match the exported types (zod schemas already exist in the backend —
  reuse them).
