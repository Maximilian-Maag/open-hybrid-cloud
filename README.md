# Open Hybrid Cloud

Self-service portal through which Admins and Project Managers can order, manage, and decommission IT infrastructure. The backend triggers CI/CD pipelines (GitLab, GitHub, Bitbucket) via webhook, which deploy the desired infrastructure using OpenTofu. Pipeline status is pushed back to the backend via CI provider webhooks — no polling worker required.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 · React 19 · Tailwind CSS v4 · NextAuth.js v5 |
| Backend | Next.js 15 · Drizzle ORM · Zod · JWT (jose) |
| Shared types | TypeScript workspace package (`packages/types`) |
| Database | PostgreSQL 16 |
| CI integration | GitLab · GitHub · Bitbucket (webhook-based) |
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

### Frontend (`apps/frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL reachable from the **browser** (used for client-side fetches) |
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
│   │   │       │   └── admin/    # Admin-domain services (catalog, config, users, …)
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
| pnpm | 9+ | `curl -fsSL https://get.pnpm.io/install.sh \| sh -` |
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
| `make test` | Run unit and integration tests |
| `make docker-build` | Build both Docker images locally |
| `make db-push` | Push Drizzle schema to the database |
| `make db-studio` | Open Drizzle Studio (visual DB browser) |
| `make docs` | Compile technical handbook to PDF |
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
# Browser-side API calls (must be reachable from your machine)
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
| API docs | http://localhost:3001/api/docs | OpenAPI (Swagger UI) |

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

```bash
cd infra
docker compose up -d
```

Configure `apps/backend/.env` and `apps/frontend/.env` with production values before starting. Nginx (`infra/nginx/`) handles reverse proxying. See `infra/docker-compose.yml` for the full service definition.

**Updating:**

```bash
docker compose pull
docker compose up -d
```

### Kubernetes

See `infra/helm/` for the Helm chart. The images are published to Docker Hub:

- `maximilianmaag/open-hybrid-cloud-backend`
- `maximilianmaag/open-hybrid-cloud-frontend`

## CI/CD

| Trigger | Pipeline |
|---------|----------|
| Pull request | Type-check + lint + build (`.github/workflows/ci.yml`) |
| Push to `dev`/`staging`/`main` | Build & push Docker images (`.github/workflows/cd-release.yml`) |
| Push to `main` | Additionally publishes a GitHub Release with `docs/handbook.pdf` |

Required GitHub secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Documentation

| Document | Path |
|----------|------|
| Architecture (C4) | `docs/architecture/workspace.dsl` |
| Requirements | `docs/requirements/requirements.md` |
| Root Manual | `docs/guides/root.md` |
| Admin Manual | `docs/guides/admin.md` |
| GitLab & OpenTofu Integration | `docs/guides/gitlab-opentofu-workflow.md` |
| Technical Handbook (PDF) | `docs/handbook.pdf` |
