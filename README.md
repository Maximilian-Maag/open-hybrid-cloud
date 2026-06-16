# Open Hybrid Cloud

Self-service portal through which Admins and project managers can order, manage, and decommission IT infrastructure. The webshop triggers GitLab CI/CD pipelines via webhook, which deploy the desired infrastructure using OpenTofu.

## Technology Stack

| Layer                 | Technology                               |
|-----------------------|------------------------------------------|
| Server                | Go                                       |
| UI                    | HTMX + Tailwind CSS                      |
| Localization          | go-i18n (24 EU languages + Russian)      |
| AI Translation        | Adapter (Claude, OpenAI, Ollama, …)      |
| Database              | PostgreSQL                               |
| Authentication        | Microsoft Entra ID (OIDC)                |
| Deployment            | Single Container (scratch image)         |
| IaC                   | OpenTofu (via GitLab CI)                 |

## Roles

| Role | Description |
|------|-------------|
| **Admin** | Can order directly, approve/reject all orders, view all projects and infrastructure. SSO via Entra ID. |
| **Project Manager** | Can place orders (approval by Admin required), manage own projects and infrastructure. SSO via Entra ID. |
| **Root** | Manages the product catalog, system configuration, and users. Can view all projects. Local account. |

## Order Process

```
Project Manager:  Orders → Pending Approval → [Approved] → Provisioning → Completed
                                             ↘ [Rejected + Mandatory Comment]

Admin:            Orders → Provisioning → Completed
```

## Email Notifications

| Event | Recipients |
|-------|-----------|
| Order received (Project Manager) | Orderer (confirmation) + all Admins (approval request) |
| Order received (Admin) | Orderer (confirmation) |
| Approval granted | Orderer |
| Rejection with comment | Orderer |
| Deployment completed | Orderer |
| Deployment failed | Orderer + all Admins |
| Decommissioning completed | Orderer |

## Product Configuration

**Parameter Inheritance:**
```
Global Parameters          → apply to all products, all environments
  └── Category Parameters  → apply to all products in a category
        └── Product Parameters (from variables.tf + manual)
              └── Environment-specific Parameters
```

**variables.tf Import:** The Root can browse repos on configured GitLab sources and select `variables.tf` files. Parameters are extracted via an HCL parser (`hashicorp/hcl/v2`) (name, type, description, default value, validation, sensitive flag).

**Deployment Environments:** Each environment (e.g. "AWS Frankfurt", "On-Premise Vienna") references a configured GitLab source. A product can be available in multiple environments, each with its own repo/webhook and pricing.

## Cost Centers

Selectable per order line item — configured by the Root:

| Mode | Meaning |
|------|---------|
| **Project** | Charged to the project's cost center (project manager must set the cost center on the project) |
| **Selection** | Orderer selects from a maintained list |
| **Overhead Cost Center** | Fixed overhead account |

The Root can set a default mode and either enforce it or suggest it only.

## Prices & Currencies

- Prices are stored per product and environment in the lead currency (e.g. VM Azure: 70 EUR, VM On-Prem: 20 EUR)
- Lead currency is globally configurable
- Displayed currency follows the user's locale (pl → PLN, cs → CZK, …)
- Exchange rates via external API, cached in DB

## Localization

- UI texts: `go-i18n` with JSON files per language
- Product content: `product_translations` table (product_id, language_code, name, description)
- Language selection: user preference in session, fallback to Accept-Language header

**AI Translation (optional):** The Root configures an AI provider (endpoint, API key, model). When a provider is configured, the admin can have product content translated with a single click and manually review it before saving.

| Provider | Type |
|----------|------|
| Claude (Anthropic) | Cloud |
| OpenAI / Azure OpenAI | Cloud |
| Ollama | On-Premise |
| LocalAI | On-Premise |

## Audit Log

Immutable compliance record of all actions. Viewable by Admin and Root. Export as **CSV** or **PDF**.

Logged events: order, approval, rejection (with comment), deployment, decommissioning, configuration changes.

## Architecture Decisions

**Go + HTMX** — Server-side rendering, HTML fragments via HTMX. No SPA framework, no client-side state.

**Tailwind CSS** — Responsive UI with a custom component design system (`ui/comp/`). CSS is generated during the Docker build stage via Node.js and embedded via `go:embed`.

**Single Container** — Go binary serves templates, static assets, and API logic in one container. Stateless, horizontally scalable.

**PostgreSQL as Single Source of Truth** — All data in PostgreSQL: product images as `bytea`, audit log, jobs for polling coordination via PostgreSQL locks.

**HCL Parser** — `hashicorp/hcl/v2` parses `variables.tf` files directly in the backend.

## Project Structure

```
open-hybrid-cloud/
├── src/                         # Go + Node source
│   ├── cmd/
│   │   ├── server/              # HTTP server entry point
│   │   └── migrate/             # Database migration tool
│   ├── internal/
│   │   ├── config/              # Configuration via environment variables
│   │   ├── handler/             # HTTP handlers (HTMX endpoints)
│   │   ├── service/             # Business logic interfaces
│   │   ├── repository/          # Database access interfaces
│   │   ├── model/               # Domain types
│   │   ├── polling/             # GitLab polling worker (goroutines)
│   │   ├── notification/        # Email dispatch
│   │   └── audit/               # Audit log
│   ├── ui/                      # go:embed root
│   │   ├── ui.go                # embed.FS declarations
│   │   ├── comp/                # Reusable templ components (design system)
│   │   ├── pages/               # Templ page templates
│   │   ├── templates/           # Legacy HTML templates (fallback)
│   │   └── static/
│   │       └── css/             # Generated Tailwind CSS
│   ├── input.css                # Tailwind input file
│   ├── tailwind.config.js
│   └── package.json
├── infra/
│   ├── Dockerfile
│   ├── docker-compose.yml       # Local development environment
│   ├── docker-host/
│   │   ├── docker-compose.yml   # Production deployment on Docker host
│   │   ├── nginx.conf.example   # Nginx configuration template
│   │   └── .env.example         # Production environment variables
│   └── helm/
│       └── open-hybrid-cloud/       # Helm chart for Kubernetes deployment
├── docs/
│   ├── workspace.dsl            # Structurizr C4 architecture
│   ├── requirements/
│   │   └── requirements.md      # Requirements document
│   └── guides/
│       ├── root.md              # Root manual
│       ├── admin.md             # Admin manual
│       └── gitlab-opentofu-workflow.md
├── .env.example                 # Local development
├── go.mod
└── Makefile
```

## Local Development

### Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Go | 1.23+ | [go.dev/dl](https://go.dev/dl/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| Docker + Docker Compose | current | [docs.docker.com](https://docs.docker.com/get-docker/) |
| GNU Make | current | Pre-installed on Linux/macOS |

On **Ubuntu** or **Manjaro** all prerequisites can be installed with a single command:

```bash
make install-requirements
```

This installs Go, Node.js, npm, Docker, Docker Compose, and the required Go tools (`goimports`, `golangci-lint`) via the native package manager. A re-login is required afterwards for the Docker group membership to take effect.

> **Note (Ubuntu):** `golang-go` from the Ubuntu repositories may be slightly behind the latest release. If Go 1.23+ is not available in your Ubuntu version, install it manually from [go.dev/dl](https://go.dev/dl/).

### Make Targets

```bash
make help         # Show all available targets
```

| Target | Description |
|--------|-------------|
| `make build` | Compile CSS + both Go binaries |
| `make run` | Start development server (`go run`) |
| `make migrate` | Run database migrations |
| `make css` | Generate Tailwind CSS once |
| `make css-watch` | Tailwind CSS in watch mode (UI development) |
| `make test` | Run tests |
| `make vet` | Run `go vet` |
| `make lint` | Run `golangci-lint` (requires `golangci-lint` in `PATH`) |
| `make install-requirements` | Install all required tools and packages (Ubuntu and Manjaro) |
| `make docker-build` | Build Docker image |
| `make dev` | Start local services (Postgres, Mailpit, Structurizr) |
| `make dev-down` | Stop local services |
| `make clean` | Remove build artifacts |

### Smoke Test Runner

The repository includes a smoke test command in `cmd/smoke/`.
Run it against a local database to verify product deletion cleanup:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/infrawebshop?sslmode=disable \
  go run ./cmd/smoke
```

This helper creates temporary product, order, and infrastructure rows and then deletes the product to validate cascading cleanup behavior.

`npm install` is run automatically when `node_modules/` is missing.

### 1. Clone the Repository

```bash
git clone <repo-url>
cd open-hybrid-cloud
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

At minimum, set the following values in `.env`:

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Random string (at least 32 characters) |
| `ADMIN_PASSWORD` | Initial password for the Root |

Entra ID (`ENTRA_*`) is **optional** for local development — the local admin account works without SSO.

### 3. Start Local Services

```bash
make dev
```

| Service | URL | Description |
|---------|-----|-------------|
| PostgreSQL | `localhost:5432` | Database |
| Mailpit Web UI | [http://localhost:8025](http://localhost:8025) | View all sent emails locally |
| Structurizr Lite | [http://localhost:8088](http://localhost:8088) | C4 architecture diagrams |

### 4. Run Database Migrations

```bash
make migrate
```

### 5. Generate CSS

```bash
make css
```

During development with watch mode (in a separate terminal):

```bash
make css-watch
```

### 6. Start the Server

```bash
make run
```

The application is available at [http://localhost:8080](http://localhost:8080).
Log in as Root using the credentials set in `.env`.

### Run Tests

```bash
make test
```

## Deployment

Both environments use the same stateless container image, publicly available on Docker Hub as `maximilianmaag/open-hybrid-cloud`.

### Docker Host

Configuration and files are located under `infra/docker-host/`.

**Server Prerequisites:**
- Docker + Docker Compose
- Valid TLS certificate (e.g. Let's Encrypt via certbot)

**Initial Setup:**

```bash
# 1. Clone the repository onto the server or copy the infra/ folder
cd infra/docker-host

# 2. Configure environment variables
cp .env.example .env
# Fill .env with actual values

# 3. Create Nginx configuration
cp nginx.conf.example nginx.conf
# Adjust server_name and ssl_certificate paths in nginx.conf

# 4. Place TLS certificates
mkdir certs
# Copy fullchain.pem and privkey.pem into ./certs/

# 5. Start the application
docker compose up -d
```

**Updating the Image:**

```bash
docker compose pull webshop
docker compose up -d --no-deps webshop
```

### Kubernetes

Nginx Ingress Controller + cert-manager handle TLS termination. Horizontal scaling via Kubernetes Deployment. PostgreSQL as a StatefulSet with persistent volume.

The container image `maximilianmaag/open-hybrid-cloud` is publicly available on Docker Hub — no `imagePullSecret` is required.

## Documentation

| Document | Path |
|----------|------|
| Architecture (C4) | `docs/architecture/workspace.dsl` |
| Requirements | `docs/requirements/requirements.md` |
| Root Manual | `docs/guides/root.md` |
| Admin Manual | `docs/guides/admin.md` |
| GitLab & OpenTofu Integration | `docs/guides/gitlab-opentofu-workflow.md` |
