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
| `ADMIN_EMAIL` | Yes | Email of the initial root account |
| `ADMIN_PASSWORD` | Yes | Password of the initial root account |
| `FRONTEND_URL` | No | Frontend origin for CORS (default: `http://localhost:3000`) |
| `SMTP_HOST` | No | SMTP server hostname |
| `SMTP_PORT` | No | SMTP server port (default: `1025`) |
| `SMTP_FROM` | No | Sender address |
| `SMTP_USER` | No | SMTP authentication username |
| `SMTP_PASS` | No | SMTP authentication password |
| `SMTP_TLS` | No | Enable TLS (`true`/`false`, default: `false`) |
| `EXCHANGE_RATE_API_URL` | No | Exchange rate API endpoint |
| `ENTRA_TENANT_ID` | No | Microsoft Entra ID tenant ID (SSO) |
| `ENTRA_CLIENT_ID` | No | Entra ID application client ID |
| `ENTRA_CLIENT_SECRET` | No | Entra ID client secret |

### Frontend (`apps/frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL reachable from the browser |
| `API_URL` | Yes | Backend URL reachable from the frontend server (SSR) |
| `NEXTAUTH_URL` | Yes | Canonical frontend URL |
| `NEXTAUTH_SECRET` | Yes | NextAuth.js signing secret (min. 32 chars) |

## Project Structure

```
open-hybrid-cloud/
├── apps/
│   ├── backend/                  # Next.js API-only app (port 3001)
│   │   ├── src/
│   │   │   ├── app/api/          # REST endpoints (route handlers)
│   │   │   └── lib/
│   │   │       ├── auth/         # JWT sign/verify, role middleware
│   │   │       ├── bootstrap/    # Root user seed on first start
│   │   │       ├── ci/           # GitLab/GitHub/Bitbucket dispatch
│   │   │       ├── db/           # Drizzle client + schema
│   │   │       ├── email/        # nodemailer notifications
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

| Tool | Version |
|------|---------|
| Node.js | 22+ |
| pnpm | 9+ |
| Docker + Docker Compose | current |

Install pnpm if not already installed:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

### Make Targets

```bash
make help
```

| Target | Description |
|--------|-------------|
| `make install` | Install all workspace dependencies |
| `make dev` | Start infra containers (postgres, mailpit, wiremock, structurizr) |
| `make dev-down` | Stop infra containers |
| `make build` | Build all apps |
| `make lint` | Lint all apps |
| `make type-check` | TypeScript type-check all apps |
| `make docker-build` | Build both Docker images locally |
| `make db-push` | Push Drizzle schema to the database |
| `make db-studio` | Open Drizzle Studio |
| `make docs` | Compile technical handbook to PDF |
| `make clean` | Remove build artifacts |

### 1. Clone and Install

```bash
git clone <repo-url>
cd open-hybrid-cloud
make install
```

### 2. Start Infrastructure

```bash
make dev
```

| Service | URL | Description |
|---------|-----|-------------|
| PostgreSQL | `localhost:5432` | Database |
| Mailpit | http://localhost:8025 | Catch-all SMTP — view sent emails |
| WireMock | http://localhost:8080 | GitLab API + Exchange Rate API stubs |
| Structurizr Lite | http://localhost:8088 | C4 architecture diagrams |

### 3. Configure Environment

Copy the example env files (already filled with local dev values):

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Or use the provided `.env` files directly — they contain working local development defaults.

### 4. Push Database Schema

```bash
make db-push
```

### 5. Start the Apps

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- API docs: http://localhost:3001/api/docs

Log in with the credentials from `apps/backend/.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). The root user is created automatically on first startup.

### Simulating a Pipeline Webhook (dev)

WireMock stubs the CI provider APIs. To simulate a pipeline completing, POST to the backend webhook endpoint:

```bash
curl -X POST http://localhost:3001/api/webhooks/gitlab/pipeline \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-Token: dev-webhook-token" \
  -d '{"object_kind":"pipeline","object_attributes":{"id":"42","status":"success"}}'
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
