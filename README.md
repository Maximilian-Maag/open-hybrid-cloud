# Open Hybrid Cloud

Self-service portal through which Admins and Project Managers can order, manage, and decommission IT infrastructure. The backend triggers CI/CD pipelines (GitLab, GitHub, Bitbucket) via webhook, which deploy the desired infrastructure using OpenTofu. Pipeline status is pushed back to the backend via CI provider webhooks — no polling worker required.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 · React 19 · Tailwind CSS v4 · NextAuth.js v5 |
| Backend | Next.js 15 · Drizzle ORM · Zod · JWT (jose) |
| Shared types | TypeScript workspace package (`packages/types`) |
| Database | PostgreSQL 16 |
| CI integration | GitLab · GitHub · Bitbucket (webhook-based, pipeline stacks) |
| Package manager | pnpm (workspaces) |
| Deployment | Two containers: `frontend` + `backend` |

## Architecture

```
Browser → Frontend (Next.js / NextAuth) → Backend REST API (Next.js)
                                               ↕
                                          PostgreSQL
                                               ↕
                              GitLab / GitHub / Bitbucket  (outbound triggers)
                              GitLab / GitHub / Bitbucket  (inbound webhooks → /api/webhooks/{provider}/pipeline)
                                          Exchange Rate API
                                          SMTP
```

Only the backend container communicates with external systems.

GitHub and Bitbucket are wired up the same way as GitLab for triggering pipelines and receiving status callbacks, but only GitLab pipeline job traces are fetched to parse OpenTofu outputs (`supportsJobTrace` in `apps/backend/src/lib/ci/index.ts`) — infrastructure provisioned through GitHub or Bitbucket gets no parsed outputs on its detail page.

## Roles

| Role | Description |
|------|-------------|
| **root** | Manages the product catalog, system configuration, and users. Local account only. |
| **admin** | Can order directly, approve/reject all orders, view all projects and infrastructure. |
| **project_manager** | Can place orders (approval by Admin required), manage own projects and infrastructure. |

## Order Process

```
project_manager:  Orders → Pending Approval → [Approved] → Provisioning → Completed
                                            ↘ [Rejected + Mandatory Comment]

admin:            Orders → Provisioning → Completed
```

On approval/creation the backend fires two sets of CI triggers in parallel:
- **Product Webhooks** (`product_webhooks` table) — ordered, multi-target webhook list per product+environment
- **Pipeline Stacks** (`pipeline_stacks` table) — step sequences sent as `PIPELINE_STACK` JSON to an orchestrator pipeline. Each step carries an `execOrder` (steps sharing a value run in parallel, higher values wait) and zero or more `upstreamRefs` mapping named CI variables to earlier steps' Terraform state — so portal-defined DAGs with cross-step data passing work without touching CI YAML

Orders can also be placed one at a time (`POST /api/orders`) or collected in a **cart** (`cart_items` table, `/cart`) and checked out together against one project (`POST /api/cart/checkout`) — checkout creates one order per cart item and reports any that failed validation without discarding the rest of the cart. Either path can be flagged as a **trial** when the chosen environment has `trialEnabled` set: the infrastructure gets an automatic `scheduledDecommissionAt` equal to the configured trial duration (see "Scheduled decommissioning" below) instead of running indefinitely. Every order has a **comment thread** (`order_comments`, `GET/POST /api/orders/{id}/comments`); admins/root can additionally mark a comment **internal**, hiding it from the project manager who placed the order.

## Environment Variables

### Backend (`apps/backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | HS256 signing secret (min. 32 chars) |
| `ADMIN_EMAIL` | Yes | Email of the initial root account (created on first start) |
| `ADMIN_PASSWORD` | Yes | Password of the initial root account |
| `FRONTEND_URL` | No | Frontend origin (default: `http://localhost:3000`) |
| `EXCHANGE_RATE_API_URL` | No | Exchange rate API endpoint |
| `ENTRA_TENANT_ID` | No | Microsoft Entra ID tenant ID — leave blank to disable SSO |
| `ENTRA_CLIENT_ID` | No | Entra ID application client ID |
| `ENTRA_CLIENT_SECRET` | No | Entra ID client secret |
| `ENTRA_REDIRECT_URI` | No | Callback URL registered in Entra ID (e.g. `https://your-domain/api/auth/callback`) |
| `SMTP_HOST` | No | SMTP server hostname — leave blank to disable email |
| `SMTP_PORT` | No | SMTP server port (default: `587`) |
| `SMTP_FROM` | No | Sender address |
| `SMTP_USER` | No | SMTP authentication username |
| `SMTP_PASS` | No | SMTP authentication password |
| `SMTP_TLS` | No | Enable TLS (`true`/`false`, default: `true`) |
| `DECOMMISSION_SWEEP_SECRET` | No | Shared secret for the scheduled-decommission sweep. Blank leaves `POST /api/internal/decommission-sweep` disabled (503) — see [Scheduled decommissioning](#scheduled-decommissioning) |
| `TRUST_PROXY` | No | Set to `1`/`true` when the backend sits behind a reverse proxy you trust to set `X-Forwarded-For` (nginx, an Ingress). Enables the **per-IP** half of the login rate limiter (`apps/backend/src/app/api/auth/login/route.ts`); the per-account half applies regardless. Leave unset when the backend is reachable directly, or the header becomes a spoofable bypass. |
| `WEBAUTHN_RP_ID` | In production | The **bare domain** security keys are scoped to — no scheme, no port, no path (`portal.example.com`, or `example.com` to work across subdomains). Blank falls back to `localhost`, so a fresh clone works with a key straight away; required when `NODE_ENV=production`. Changing it invalidates every registered credential |
| `WEBAUTHN_RP_ORIGIN` | In production | The full origin the browser sees, **with scheme** (`https://portal.example.com`). Comma-separate several if the portal answers on more than one hostname; `WEBAUTHN_RP_ID` must be a suffix of each. Validated at first use — getting either wrong works perfectly on localhost and breaks every key on the deployed instance |
| `SECRET_ENCRYPTION_KEY` | No | 64 hex characters (`openssl rand -hex 32`) encrypting the credentials of external-system integrations (Foreman, Ansible, Nexus, Pulp, Loki, Grafana). Blank leaves that feature off — the endpoints refuse to store a credential (503) rather than storing it in plain text. Not rotatable once in use: a new key cannot decrypt what the old one wrote |

Only `JWT_SECRET` and `DATABASE_URL` are enforced at startup (`apps/backend/src/lib/config/validate.ts`) — an invalid or missing one is reported on `GET /api/health` rather than crashing the process. `ADMIN_EMAIL`/`ADMIN_PASSWORD` are listed as required because a blank value produces a broken root account on first boot, not because anything currently refuses to start without them.

### Frontend (`apps/frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL reachable from the **browser**. Only for unauthenticated assets (product images): every authenticated call from client JavaScript goes to the frontend's own `/api/proxy`, which attaches the token server-side (#146) |
| `API_URL` | Yes | Backend URL reachable from the **frontend server** (used for SSR) |
| `NEXTAUTH_URL` | Yes | Canonical frontend URL |
| `NEXTAUTH_SECRET` | Yes | NextAuth.js signing secret (min. 32 chars) |

## Project Structure

```
open-hybrid-cloud/
├── apps/
│   ├── backend/                  # Next.js API-only app (port 3001)
│   │   ├── src/
│   │   │   ├── app/api/          # Thin route handlers (auth → service → toResponse)
│   │   │   └── lib/
│   │   │       ├── auth/         # JWT sign/verify, role middleware
│   │   │       ├── bootstrap/    # Root user seed on first start
│   │   │       ├── ci/           # GitLab/GitHub/Bitbucket dispatch + webhook triggering
│   │   │       ├── db/           # Drizzle client, schema, shared query helpers
│   │   │       ├── http.ts       # toResponse() — maps Result<T> to NextResponse
│   │   │       ├── notification/ # nodemailer email notifications
│   │   │       ├── services/     # Domain services: all business logic, returns Result<T>
│   │   │       │   └── admin/    # Admin-domain services (catalog, config, users, pipeline-stacks, …)
│   │   │       └── webhook/      # CI pipeline event handler
│   │   ├── Dockerfile
│   │   └── drizzle.config.ts
│   └── frontend/                 # Next.js UI app (port 3000)
│       ├── src/
│       │   ├── app/              # App Router pages
│       │   └── lib/
│       │       ├── api.ts        # Typed fetch wrappers
│       │       └── auth.ts       # NextAuth.js config
│       └── Dockerfile
├── packages/
│   └── types/                    # Shared TypeScript interfaces
├── policy/                       # Rego codebase invariants enforced by `make policy`
├── scripts/
│   ├── policy-facts.ts           # Extracts the JSON the Rego policies evaluate
│   ├── policy-check.ts           # `make policy` — opa test, then opa eval
│   └── opa.ts                    # The pinned opa binary, by version and checksum
├── infra/
│   ├── docker-compose.dev.yml    # Local dev: postgres, mailpit, wiremock, structurizr
│   ├── docker-compose.yml        # Docker host deployment
│   ├── nginx/                    # Reverse proxy config
│   ├── wiremock/                 # External API stubs for local dev
│   └── helm/                     # Kubernetes Helm chart
├── docs/
│   ├── architecture/
│   │   └── workspace.dsl         # Structurizr C4 architecture
│   ├── requirements/
│   │   └── requirements.md
│   └── guides/
│       ├── root.md
│       ├── admin.md
│       └── gitlab-opentofu-workflow.md
├── Makefile
├── package.json
└── pnpm-workspace.yaml
```

## Local Development

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22+ | https://nodejs.org or `nvm install 22` |
| pnpm | 11.9.0 (pinned via `packageManager` in `package.json`) | `corepack enable` (Node ≥16.9 ships Corepack) |
| Docker + Docker Compose | current | https://docs.docker.com/get-docker/ |

### Make Targets

Run `make help` to see all available commands.

| Target | Description |
|--------|-------------|
| `make install` | Install all workspace dependencies |
| `make dev` | Start infra containers (postgres, mailpit, wiremock, structurizr) |
| `make dev-down` | Stop infra containers |
| `make run` | Start backend **and** frontend dev servers together |
| `make run-backend` | Start only the backend dev server (`:3001`) |
| `make run-frontend` | Start only the frontend dev server (`:3000`) |
| `make build` | Build all apps |
| `make lint` | Lint all apps |
| `make type-check` | TypeScript type-check all apps |
| `make policy` | Run the OPA codebase-invariant gate — the same check CI runs (see [Policy gate](#policy-gate)) |
| `make test` | Run unit and integration tests |
| `make docker-build` | Build both Docker images locally |
| `make db-push` | Push Drizzle schema to the database |
| `make db-studio` | Open Drizzle Studio (visual DB browser) |
| `make handbook` | Compile the technical handbook to `docs/handbook.pdf` (not committed — see [Technical Handbook](#technical-handbook)) |
| `make clean` | Remove build artifacts |

---

### Step-by-step Setup

#### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd open-hybrid-cloud
make install
```

#### 2. Start the local infrastructure

```bash
make dev
```

This starts four containers defined in `infra/docker-compose.dev.yml`:

| Service | URL | Purpose |
|---------|-----|---------|
| PostgreSQL | `localhost:5432` | Application database |
| Mailpit | http://localhost:8025 | Catch-all SMTP inbox — view all outgoing emails |
| WireMock | http://localhost:8080 | Stubs for GitLab API and Exchange Rate API |
| Structurizr Lite | http://localhost:8088 | Live C4 architecture diagram viewer |

Wait for the containers to be healthy before continuing (the `--wait` flag handles this automatically).

#### 3. Configure environment variables

Copy the example files:

```bash
cp apps/backend/.env.example  apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

**`apps/backend/.env` — changes required for local dev:**

```dotenv
# The example points at the Docker service name; change to localhost for running outside Docker
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/open_hybrid_cloud

# Any random string — used to sign JWTs
JWT_SECRET=my-local-dev-secret

# Credentials for the root account created on first startup
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme

# Keep the rest at their defaults; SMTP/SSO can stay blank to be disabled
FRONTEND_URL=http://localhost:3000
EXCHANGE_RATE_API_URL=http://localhost:8080/exchange-rates  # WireMock stub
```

**`apps/frontend/.env` — changes required for local dev:**

```dotenv
# Browser-side asset URLs, e.g. product images (must be reachable from your machine)
NEXT_PUBLIC_API_URL=http://localhost:3001

# Server-side (SSR) API calls — same target when running outside Docker
API_URL=http://localhost:3001

NEXTAUTH_URL=http://localhost:3000

# Any random string — used to sign NextAuth sessions
NEXTAUTH_SECRET=my-local-nextauth-secret
```

> **Note:** `SMTP_*` and `ENTRA_*` variables can be left blank. Leaving SMTP blank disables email notifications. Mailpit is available as a dev SMTP server if you want to test emails — set `SMTP_HOST=localhost` and `SMTP_PORT=1025`.

#### 4. Initialise the database

The first time (and any time you add a new migration):

```bash
make db-push
```

This pushes the Drizzle schema directly to the local database. Alternatively, `make db-studio` opens a visual browser at http://localhost:4983.

> **Note:** In production/staging, migrations run automatically when the backend starts (via `GET /api/health`). For local dev, `db-push` is the quickest way to sync the schema.

#### 5. Start the dev servers

```bash
make run          # backend (:3001) + frontend (:3000) in parallel
```

Or start them individually in separate terminals:

```bash
make run-backend  # terminal 1
make run-frontend # terminal 2
```

| App | URL | Notes |
|-----|-----|-------|
| Frontend | http://localhost:3000 | Next.js with hot reload |
| Backend | http://localhost:3001 | Next.js API with hot reload |
| API docs | http://localhost:3001/api/docs | OpenAPI (Swagger UI) — requires a signed-in session; log in via the frontend first |

#### 6. Log in

Open http://localhost:3000 and sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `apps/backend/.env`. The root user is created automatically the first time the backend starts (triggered by the first request to `/api/health`).

---

### Development Workflow

#### Database changes

1. Edit `apps/backend/src/lib/db/schema.ts`
2. Run `make db-push` to apply changes to your local database
3. When ready for a production migration, generate a SQL migration file:
   ```bash
   pnpm --filter backend db:generate
   ```
   Commit the generated file under `apps/backend/drizzle/`.

#### Running tests

```bash
make test                         # all unit + integration tests
pnpm --filter backend test:watch  # backend tests in watch mode
pnpm --filter frontend test       # frontend tests only
```

Integration tests require the postgres container to be running (`make dev`).

#### Simulating a CI/CD pipeline webhook

WireMock stubs the CI provider APIs. To simulate a pipeline event reaching the backend, POST directly to the webhook endpoint:

```bash
# GitLab — pipeline succeeded
curl -X POST http://localhost:3001/api/webhooks/gitlab/pipeline \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-Token: dev-webhook-token" \
  -d '{"object_kind":"pipeline","object_attributes":{"id":"42","status":"success"}}'

# GitHub — workflow completed
curl -X POST http://localhost:3001/api/webhooks/github/workflow \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<hmac>" \
  -d '{"action":"completed","workflow_run":{"id":42,"conclusion":"success"}}'
```

Replace `"success"` with `"failed"` or `"canceled"` to test failure paths.

#### Viewing sent emails

All emails sent by the backend during local dev are captured by Mailpit. Open http://localhost:8025 to browse the inbox — no real emails are sent.

#### Viewing the architecture diagram

Open http://localhost:8088 while `make dev` is running. Structurizr Lite reads `docs/architecture/workspace.dsl` and renders the C4 diagrams live.

---

### Stopping everything

```bash
# Stop the dev servers: Ctrl+C in the terminal running make run

# Stop the infrastructure containers:
make dev-down
```

## Deployment

### Docker Host

Two different single-host setups exist under `infra/`, and they are not interchangeable:

**A. Build from source** (`infra/docker-compose.yml`) — builds the frontend/backend images locally instead of pulling them:

```bash
cd infra
docker compose up -d
```

Configuration comes from `infra/docker-host/.env` (`env_file:` on every service, not `apps/*/env`) — copy `infra/docker-host/.env.example` and fill it in before starting. Nginx (`infra/nginx/default.conf`) terminates plain HTTP only; there is no TLS setup in this path.

**B. Pull published images, with auto-update** (`infra/docker-host/`) — the path the release images (below) are meant for: pulls from Docker Hub, adds a `watchtower` container that polls for and applies new image tags, and expects TLS certificates:

```bash
cd infra/docker-host
cp .env.example .env            # fill in DOCKERHUB_USERNAME, secrets, etc.
cp nginx.conf.example nginx.conf # fill in your domain
mkdir -p certs                   # place fullchain.pem + privkey.pem here
sudo ./setup.sh --install        # Debian only; also installs Docker itself
```

`setup.sh` also supports `--upgrade` (pull the newer images), `--logs [service]` and `--status` — see the script for what each does. Path A passes the backend container everything in `docker-host/.env` via `env_file:`, so adding `TRUST_PROXY` or `DECOMMISSION_SWEEP_SECRET` there is enough. Path B's `docker-compose.yml` instead lists each backend variable individually under `environment:`, and does **not** list `TRUST_PROXY` or `DECOMMISSION_SWEEP_SECRET` — setting them in that directory's `.env` has no effect until the compose file's backend `environment:` block also names them.

### Kubernetes

See `infra/helm/` for the Helm chart. The images are published to Docker Hub:

- `maximilianmaag/open-hybrid-cloud-backend`
- `maximilianmaag/open-hybrid-cloud-frontend`

### Scheduled decommissioning

Users can set a future time at which an infrastructure element is torn down
automatically, so temporary environments (test, demo, PoC) stop accruing cost when
they are forgotten. Setting the time works out of the box; **acting on it needs a
scheduler**, because the backend has no worker process and is horizontally scaled
— an in-process timer would run once per replica.

Point any scheduler at `POST /api/internal/decommission-sweep`, authenticated with
`DECOMMISSION_SWEEP_SECRET` in an `X-Sweep-Secret` header. While that variable is
unset the endpoint returns 503, so it can never be called anonymously.

The sweep is idempotent — its `active → decommissioning` claim is atomic, so
overlapping or replayed runs cannot tear anything down twice — and the schedule
interval is the granularity of the feature: an element is torn down at the first
sweep at or after its time, not to the second.

| Deployment | How |
|------------|-----|
| Kubernetes | Set `decommissionSweep.enabled=true` and `decommissionSweep.secret` (Helm renders a `CronJob`; `decommissionSweep.schedule` defaults to every 15 minutes) |
| Docker host / bare metal | A cron entry — see the `DECOMMISSION_SWEEP_SECRET` block in `.env.example` for a ready-made line |

Response codes: `200` all due elements torn down, `207` some could not be started
(the body's `failed[]` says which — a product whose destroy triggers are broken),
`401` bad secret, `503` feature not configured.

## CI/CD

| Trigger | Pipeline |
|---------|----------|
| Pull request | Type-check + lint + build + E2E + a11y gate + policy gate, and (only if the PR touches `docs/handbook.tex`) a handbook compile check (`.github/workflows/ci.yml`) |
| Push to `dev`/`staging`/`main` | Build & push Docker images (`.github/workflows/cd-release.yml`) |
| Push to `main` | Additionally compiles the handbook fresh from `docs/handbook.tex` and publishes a GitHub Release with the resulting PDF attached |

Required GitHub secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Policy Gate

`make policy` evaluates the Rego policies in `policy/` against the source tree
and fails on a `deny`. It is the same command the "Policy (OPA)" job in
`.github/workflows/ci.yml` runs, so a green run locally is the answer CI will
give.

It exists because ESLint enforces rules about *a file*, and every recurring
defect in this repository has been a rule that spans files — a route whose auth
helper is missing, a table added to `schema.ts` and to a migration but not to
both places in `src/test/setup.ts`, an i18n key present in 2 of 25 languages, a
`select()` that reached one column too far, a language code added to the picker
but not to the AI prompt that translates for it, a variable the code reads that
no `.env.example` tells an operator to set. Those are sentences you can write
down, which makes them policy rather than lint.

```bash
make policy-install-opa   # once: fetches the pinned opa into .opa/ (gitignored, checksum-verified)
make policy               # opa test on the policies, then opa eval on the tree
make policy-facts         # the JSON the policies see, if a rule is not firing as expected
```

Each violation prints the rule, the file and *why the rule exists*, because a
policy failure that does not explain itself gets suppressed rather than fixed:

```
DENY  route_requires_auth  apps/backend/src/app/api/reports/route.ts
      exports GET but never calls requireAuth or requireRole, and "reports" is not on
      the public allowlist
      why: Whether a route authenticates is not visible in the file a reviewer is reading
           — it is the absence of a call. ...
```

`deny` fails the build; `warn` reports and does not. A rule that cannot pass on
`dev` yet ships as `warn` naming the issue that will promote it — a gate that
starts red teaches people to ignore it. Adding a rule is one block in
`policy/*.rego` and one test in the matching `*_test.rego`; the facts it reasons
about come from `scripts/policy-facts.ts`.

This bundle is **not** the runtime policy engine of issue #110. It never runs in
production: its input is the source tree and its only output is a CI verdict.

## Technical Handbook

`docs/handbook.tex` compiles to a PDF, but the PDF itself is **not committed** — a
generated artefact next to its source drifts the moment someone edits the source
and forgets to recompile, and nothing enforced regenerating it. Instead:

- `make handbook` compiles it locally to `docs/handbook.pdf` (gitignored).
- Any pull request that touches `docs/handbook.tex` gets a CI job (`.github/workflows/ci.yml`) that compiles it and uploads the result as a build artifact ("handbook-pdf") — so a LaTeX error is caught in review, not discovered when someone tries to build a release.
- Every push to `main` compiles it fresh and attaches it to that push's GitHub Release (`.github/workflows/cd-release.yml`) — the canonical place to download the current handbook.

Both CI jobs use the same pinned LaTeX action (`xu-cheng/latex-action`, pinned by commit SHA like every other third-party action in this repo), so the PR check and the release build agree with each other. `make handbook` is *not* that toolchain — it shells out to your local `pdflatex` — so a green local build is evidence the source compiles, not proof CI will produce the same PDF.

## Documentation

| Document | Path |
|----------|------|
| Architecture (C4) | `docs/architecture/workspace.dsl` |
| Requirements | `docs/requirements/requirements.md` |
| Root Manual | `docs/guides/root.md` |
| Admin Manual | `docs/guides/admin.md` |
| GitLab & OpenTofu Integration | `docs/guides/gitlab-opentofu-workflow.md` |
| Technical Handbook (source) | `docs/handbook.tex` — see [Technical Handbook](#technical-handbook) for how to get the PDF |
