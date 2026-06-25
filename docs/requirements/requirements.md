# Requirements Open Hybrid Cloud

## 1. Functional Requirements

### FA-01 User Roles and Access Rights

| ID | Requirement |
|----|-------------|
| FA-01.1 | The system recognizes three roles: **Admin**, **Project Manager**, and **Root**. |
| FA-01.2 | Admins and Project Managers authenticate via SSO using Microsoft Entra ID (OIDC). |
| FA-01.3 | The Root uses a local account. Local accounts can only be created by the Root. |
| FA-01.4 | Admins can see all orders, projects, and infrastructure elements of all users. |
| FA-01.5 | Project Managers can only see their own orders, projects, and infrastructure elements. |
| FA-01.6 | The Root can see all projects and infrastructure elements, but cannot place orders. |

---

### FA-02 Product Catalog

| ID | Requirement |
|----|-------------|
| FA-02.1 | Products are organized into categories. Categories are manageable by the Root. |
| FA-02.2 | Each product has: name, description, image, category, parameter sets, and prices per deployment environment. |
| FA-02.3 | Product images are stored in the database (PostgreSQL `bytea`). |
| FA-02.4 | Product content (name, description) is multilingual (all 24 EU official languages + Russian). |
| FA-02.5 | Each product can be available in one or more deployment environments. |
| FA-02.6 | Price and cost center configuration can be defined separately per product and environment. |

---

### FA-03 AI-Assisted Translation

| ID | Requirement |
|----|-------------|
| FA-03.1 | The translation feature is optional. Without a configured AI provider, it is hidden. |
| FA-03.2 | The Root selects an AI provider in the admin panel and provides the endpoint, API key, and model. |
| FA-03.3 | Supported providers: Claude (Anthropic), OpenAI, Azure OpenAI (Cloud); Ollama, LocalAI (On-Premise). |
| FA-03.4 | The admin creates product content in a base language and can trigger AI translation with a single click. |
| FA-03.5 | All AI-generated translations can be manually corrected before saving. |

---

### FA-04 Product Parameters

| ID | Requirement |
|----|-------------|
| FA-04.1 | Parameters are inherited in a hierarchy: Global → Category → Product → Environment. |
| FA-04.2 | When creating a product, the Root can import `variables.tf` files from configured GitLab repositories. Parameters are extracted via an HCL parser (name, type, description, default value, validation, sensitive flag). |
| FA-04.3 | Parameters can be created, edited, and deleted manually. |
| FA-04.4 | Global parameter sets can be defined that apply to all products and environments. |
| FA-04.5 | Category parameter sets can be defined that apply to all products within a category. |
| FA-04.6 | Parameters can be marked as environment-specific (apply only to selected environments). |

---

### FA-05 Deployment Environments and GitLab Sources

| ID | Requirement |
|----|-------------|
| FA-05.1 | Multiple GitLab instances can be configured as sources (name, URL, access token). |
| FA-05.2 | Multiple deployment environments can be configured (e.g., "AWS Frankfurt", "On-Premise Vienna"). |
| FA-05.3 | Each deployment environment references a GitLab source and a specific repo/webhook. |
| FA-05.4 | When creating a product, the Root can browse repositories on configured GitLab sources and select `variables.tf` files. |

---

### FA-06 Order Process

| ID | Requirement |
|----|-------------|
| FA-06.1 | Orders must be assigned to a project. |
| FA-06.2 | The orderer selects the deployment environment during the ordering process. |
| FA-06.3 | The order form is generated dynamically from the applicable parameter sets. |
| FA-06.4 | Each order item must be assigned to a cost center (mode: project, selection, or shared cost center). |
| FA-06.5 | Admins trigger the GitLab provisioning webhook directly after checkout. |
| FA-06.6 | Orders from Project Managers wait for approval by an Admin after checkout. |
| FA-06.7 | An existing project can be used as a template for a new order (parameters are pre-filled). |

---

### FA-07 Approval Workflow

| ID | Requirement |
|----|-------------|
| FA-07.1 | Any Admin can approve or reject pending orders from Project Managers. |
| FA-07.2 | A comment is mandatory when rejecting an order. |
| FA-07.3 | Approval triggers the GitLab provisioning webhook with the order parameters. |
| FA-07.4 | Rejection with the mandatory comment is delivered to the Project Manager via email. |

---

### FA-08 Infrastructure Overview

| ID | Requirement |
|----|-------------|
| FA-08.1 | Deployed infrastructure elements are displayed grouped by project and deployment environment. |
| FA-08.2 | Admins and Root users can see all projects. Project Managers only see their own. |
| FA-08.3 | Each infrastructure element shows: product, environment, order parameters, status, price, cost center. |

---

### FA-09 Decommissioning

| ID | Requirement |
|----|-------------|
| FA-09.1 | Infrastructure elements can be decommissioned from within the infrastructure overview. |
| FA-09.2 | Admins can decommission all infrastructure elements. Project Managers can only decommission their own. |
| FA-09.3 | Decommissioning triggers the GitLab destroy webhook of the associated OpenTofu module. |
| FA-09.4 | The decommissioning status is updated via the GitLab polling mechanism. |
| FA-09.5 | When a **project** is deleted, all active infrastructure elements belonging to that project are automatically decommissioned (destroy webhook fired) before the project record is removed. |
| FA-09.6 | When a **product** is deleted, all active infrastructure elements provisioned from that product are automatically decommissioned before the product record is removed. |
| FA-09.7 | When a **category** is deleted, all active infrastructure elements belonging to any product in that category are automatically decommissioned before the category record is removed. |
| FA-09.8 | Infrastructure already in status *Decommissioning* or *Decommissioned* is skipped during cascade decommissioning. |

---

### FA-10 Projects and Cost Centers

| ID | Requirement |
|----|-------------|
| FA-10.1 | Users can create and manage projects. |
| FA-10.2 | Project Managers must be able to assign a cost center to each project. |
| FA-10.3 | The Root maintains a list of available cost centers. |
| FA-10.4 | The Root can configure the cost center assignment mode per product: **Project** (cost center of the project), **Selection** (orderer selects from list), **Shared Cost Center** (fixed overhead). |
| FA-10.5 | The Root can set a mode as default and either enforce it or only suggest it. |

---

### FA-11 Prices and Currencies

| ID | Requirement |
|----|-------------|
| FA-11.1 | Prices are informational only (no payment processing). |
| FA-11.2 | Prices are stored per product and deployment environment in the base currency. |
| FA-11.3 | The base currency is globally configurable (default: EUR). |
| FA-11.4 | The displayed currency is based on the user's locale (e.g., pl → PLN, cs → CZK). |
| FA-11.5 | Exchange rates are fetched from an external API and cached in the database. |
| FA-11.6 | The Root can manually refresh the exchange rates. |

---

### FA-12 Localization

| ID | Requirement |
|----|-------------|
| FA-12.1 | The UI is available in all 24 EU official languages and Russian. |
| FA-12.2 | Language selection is based on the user's session preference, with fallback to the Accept-Language header. |
| FA-12.3 | Product content (name, description) is loaded language-specifically from a translation table. |

---

### FA-13 Notifications

| ID | Event | Recipient |
|----|-------|-----------|
| FA-13.1 | Order received (Project Manager) | Orderer (confirmation) + all Admins (approval request) |
| FA-13.2 | Order received (Admin) | Orderer (confirmation) |
| FA-13.3 | Approval granted | Orderer |
| FA-13.4 | Rejection with mandatory comment | Orderer |
| FA-13.5 | Deployment completed | Orderer |
| FA-13.6 | Deployment failed | Orderer + all Admins |
| FA-13.7 | Decommissioning completed | Orderer |

---

### FA-14 Audit Log

| ID | Requirement |
|----|-------------|
| FA-14.1 | All relevant actions are logged immutably: order, approval, rejection (with comment), deployment start, deployment completion, deployment failure, decommissioning, configuration changes. |
| FA-14.2 | The audit log is viewable and filterable by Admins and Root users. |
| FA-14.3 | The audit log can be exported as CSV or PDF. The format is selectable at export time. |

---

## 2. Non-Functional Requirements

### NFA-01 Deployment and Operations

| ID | Requirement |
|----|-------------|
| NFA-01.1 | The application runs as a single stateless Docker container. |
| NFA-01.2 | **Docker Host:** An Nginx container (official image) handles HTTPS termination and forwards requests via reverse proxy. |
| NFA-01.3 | **Docker Host:** The application image is stored in a private DockerHub registry. The Docker daemon must be authenticated via `docker login` before startup. All other images (nginx, postgres) are official images. |
| NFA-01.4 | **Kubernetes:** Nginx Ingress Controller + cert-manager handle TLS termination (Let's Encrypt or internal CA). The private image is pulled via an `imagePullSecret` in the namespace. |
| NFA-01.5 | Configuration is done exclusively via environment variables (12-Factor App). No configuration files inside the container. |
| NFA-01.6 | The GitLab server is reachable via a configurable URL. |
| NFA-01.7 | The deployment configuration for the Docker Host is located under `infra/docker-host/` and contains: `docker-compose.yml`, `nginx.conf.example`, and `.env.example`. |

---

### NFA-02 Scalability and Statelessness

| ID | Requirement |
|----|-------------|
| NFA-02.1 | The application container is fully stateless. No local state between requests. |
| NFA-02.2 | Sessions are stored in encrypted HttpOnly cookies — no server-side session store required. |
| NFA-02.3 | The GitLab polling service coordinates jobs via PostgreSQL locks — safe with multiple container replicas. |
| NFA-02.4 | Horizontal scaling (multiple replicas) must work without any configuration changes. |

---

### NFA-03 Authentication and Security

| ID | Requirement |
|----|-------------|
| NFA-03.1 | SSO authentication is performed via Microsoft Entra ID using the OpenID Connect Authorization Code Flow. |
| NFA-03.2 | Local accounts are exclusively intended for the Root. |
| NFA-03.3 | All external connections (GitLab, Entra ID, SMTP, APIs) use HTTPS/TLS. |
| NFA-03.4 | API keys and secrets (GitLab tokens, SMTP credentials, session secret) are configured exclusively via environment variables. |

---

### NFA-04 Data

| ID | Requirement |
|----|-------------|
| NFA-04.1 | All webshop data is stored in PostgreSQL. No filesystem dependencies at runtime. |
| NFA-04.2 | Product images are stored as `bytea` in PostgreSQL. |
| NFA-04.3 | The audit log is immutable (no UPDATE/DELETE operations on audit entries). |
