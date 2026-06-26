workspace "Open Hybrid Cloud" "Self-service portal for ordering, managing and decommissioning IT infrastructure. Next.js frontend + Next.js REST API backend, two containers." {

    model {
        admin = person "Admin" "Administrator. Can view all orders, projects and infrastructure, order directly and approve or reject orders from project managers." "Person"
        root = person "Root" "Manages the product catalog, system configuration and local user accounts. Can view all projects and infrastructure. Uses a local account." "Person"
        project_manager = person "Project Manager" "Can place orders (approval by Admin required), decommission own infrastructure and manage projects. Can only view own projects, orders and infrastructure." "Person"

        gitlab = softwaresystem "GitLab" "Multiple configurable GitLab instances as sources for OpenTofu modules. Receives provisioning and destroy webhooks, executes OpenTofu workflows, provides an API for the repository browser and pushes pipeline status events back to the Backend API via webhooks." "Existing System"
        oidc_provider = softwaresystem "Microsoft Entra ID" "SSO identity provider (OIDC) for authenticating admins and project leaders." "Existing System"
        ai_translation = softwaresystem "AI Translation Service" "Configurable AI provider for translating product content into all EU languages and Russian. Cloud: Claude, OpenAI, Azure OpenAI. On-premise: Ollama, LocalAI. Optional — hidden when not configured." "Existing System"
        smtp = softwaresystem "Mail Server" "SMTP server for transactional emails: order confirmation, approval request, approval/rejection, deployment completion and error notifications." "Existing System"
        exchange_rate_api = softwaresystem "Exchange Rate API" "External API for current exchange rates. Used to convert from the configured base currency to the display currency per user locale." "Existing System"

        webshop = softwaresystem "Open Hybrid Cloud" "Self-service portal through which admins and project leaders can order, manage and decommission IT infrastructure." {

            frontend = container "Frontend" "Next.js application serving the React UI. Handles routing, server-side rendering and client-side interactivity. Communicates exclusively with the Backend API via REST. Manages user sessions via NextAuth.js." "Next.js / React / Tailwind CSS / NextAuth.js" {

                ui_auth = component "Auth Pages" "Login page supporting local credentials and SSO. NextAuth.js manages session lifecycle and executes the OIDC Authorization Code Flow with Entra ID. JWT stored in an encrypted HttpOnly cookie and forwarded as a Bearer token to the Backend API."
                ui_catalog = component "Catalog" "Product grid filtered by category with search. Displays image, multilingual name, description and price converted to the user's locale currency. Environment selection and parameter form when placing an order."
                ui_orders = component "Orders" "Order creation form with dynamically rendered parameter fields. Project and cost centre assignment. Order list with status indicators and detail view with live status polling."
                ui_approvals = component "Approvals" "Pending order queue for admins. Inline approve and reject actions. Rejection requires a mandatory comment."
                ui_infrastructure = component "Infrastructure" "Deployed infrastructure items grouped by project and environment. Shows OpenTofu outputs. Decommission trigger with confirmation."
                ui_audit = component "Audit Log" "Filterable compliance log. Filter by user, action and date range. Export as CSV or PDF."
                ui_admin = component "Administration" "Full product catalog management: categories, products, images, multilingual content, parameter sets, prices per environment, cost centre configuration, GitLab sources, deployment environments, users, branding, SMTP, AI provider and exchange rates."
                ui_settings = component "Settings" "User profile update and password change."
            }

            backend = container "Backend API" "Next.js application exposing a RESTful API. Contains all business logic, database access and external system integrations. Purely functional — no classes, pure functions, immutable data, neverthrow for error handling. OpenAPI 3.0 spec auto-generated from Zod schemas via @asteasolutions/zod-to-openapi and served as Swagger UI at /api/docs." "Next.js / TypeScript / Drizzle ORM / Zod / JWT" {

                api_auth = component "Auth API" "POST /api/auth/login: verifies bcrypt password, issues signed JWT. GET /api/auth/callback: handles Entra ID OIDC callback, upserts SSO user, issues JWT. JWT validation middleware applied to all protected routes. Role hierarchy: root > admin > project_manager."
                api_catalog = component "Catalog API" "GET /api/catalog: paginated product list with category filter and full-text search. GET /api/catalog/{id}: product detail with environment options, prices and parameters. GET /api/products/{id}/image: product image binary."
                api_orders = component "Orders API" "POST /api/orders: validates parameters, assigns project and cost centre, creates order. Admin orders auto-approve and trigger CI provider pipeline immediately. GET /api/orders and GET /api/orders/{id}: order list and detail with pipeline status."
                api_approvals = component "Approvals API" "GET /api/approvals: pending orders for admins. POST /api/approvals/{id}/approve: triggers CI provider pipeline, transitions order to provisioning. POST /api/approvals/{id}/reject: stores rejection comment, notifies orderer."
                api_infrastructure = component "Infrastructure API" "GET /api/infrastructure: infrastructure elements filtered by role. POST /api/infrastructure/{id}/decommission: triggers CI provider destroy pipeline, transitions element to decommissioning."
                api_admin = component "Administration API" "Full CRUD under /api/admin/* for: categories, products, product translations, parameters, environments, CI sources (GitLab/GitHub/Bitbucket), cost centres, users, branding, app config (SMTP, AI provider). GET /api/admin/ci/*: repository browser proxy to CI provider API. POST /api/admin/ci/import-vars: parses variables.tf and creates parameters."
                api_webhook = component "CI Webhook Receiver" "Receives inbound pipeline status events pushed by CI providers. POST /api/webhooks/gitlab/pipeline, /api/webhooks/github/workflow, /api/webhooks/bitbucket/pipeline. Verifies provider-specific signatures (token or HMAC-SHA256). Normalises payload to a common PipelineEvent type. On success: fetches job trace, parses OpenTofu outputs, transitions order or infrastructure element to completed/decommissioned, logs audit entry, triggers notification. On failure: transitions to failed, logs audit entry, triggers notification."
                api_audit = component "Audit API" "POST /api/audit: writes immutable audit entry (called internally after every significant action). GET /api/audit: filterable log for admins. GET /api/audit/export: streams CSV or PDF."
                api_notification = component "Notification" "Sends transactional emails via Nodemailer. Events: OrderCreated (orderer + all admins for project leaders), OrderApproved, OrderRejected (orderer), ProvisioningCompleted, ProvisioningFailed (orderer + all admins), Decommissioned (orderer)."
                api_ai = component "AI Translation" "POST /api/admin/products/{id}/translate: sends product content to the configured AI provider and writes translations for all 25 supported languages. Supports Claude, OpenAI, Azure OpenAI, Ollama and LocalAI via a shared prompt/response format."
                api_exchange = component "Exchange Rates" "POST /api/admin/currencies/refresh: fetches current rates from external API and stores them. GET /api/exchange/{from}/{to}: converts amounts using cached rates."
                api_ci = component "CI Provider Client" "Internal module providing a unified interface over multiple CI provider APIs. Supports GitLab API v4, GitHub REST API and Bitbucket API 2.0. Methods: list repositories/branches/files, trigger pipeline, fetch job trace, parse OpenTofu outputs. Implemented as a discriminated union dispatch — no classes."
                api_docs = component "OpenAPI / Swagger UI" "GET /api/docs: Swagger UI. GET /api/docs/spec: OpenAPI 3.0 JSON spec auto-generated from Zod request and response schemas registered via @asteasolutions/zod-to-openapi."
            }

            database = container "Database" "Persistence of all portal data: product categories, products (image as BYTEA), product translations (per BCP-47 language code), parameter sets (global, category, product and environment scope), GitLab sources, deployment environments, product webhooks (multiple per product+environment ordered by exec_order), prices per product and environment, cost centres, exchange rates, projects, orders (parameters as JSONB, pipeline IDs as JSONB array, rejection comment), infrastructure elements (parameters, pipeline IDs and OpenTofu outputs as JSONB), audit log, local users (bcrypt hashed passwords, SSO subject), branding (logo as BYTEA, colors, shop name, imprint) and app config (SMTP, AI provider)." "PostgreSQL 16" "Database"
        }

        # Relationships — system level
        admin -> webshop "Orders IT infrastructure directly, approves orders, monitors all projects"
        root -> webshop "Manages product catalog, system configuration and users"
        project_manager -> webshop "Orders and manages own IT infrastructure"
        webshop -> gitlab "Browses repositories, triggers pipelines" "JSON/HTTPS"
        gitlab -> webshop "Pushes pipeline status events via webhook" "JSON/HTTPS"
        webshop -> oidc_provider "Authenticates admins and project leaders" "OIDC/HTTPS"
        webshop -> ai_translation "Translates product content (optional, configurable)" "JSON/HTTPS"
        webshop -> smtp "Sends transactional emails" "SMTP"
        webshop -> exchange_rate_api "Fetches current exchange rates" "JSON/HTTPS"

        # Relationships — container level
        admin -> frontend "Uses web interface" "HTTPS"
        root -> frontend "Manages shop" "HTTPS"
        project_manager -> frontend "Uses web interface" "HTTPS"
        frontend -> backend "All data and actions via REST API" "JSON/HTTPS"
        backend -> database "Reads and writes all portal data" "SQL/TCP"
        backend -> gitlab "Triggers pipelines, browses repositories, fetches job traces" "JSON/HTTPS"
        gitlab -> backend "Pushes pipeline status events via webhook" "JSON/HTTPS"
        backend -> oidc_provider "OIDC Authorization Code Flow" "OIDC/HTTPS"
        backend -> ai_translation "AI translation requests (optional)" "JSON/HTTPS"
        backend -> smtp "Sends transactional emails via Nodemailer" "SMTP"
        backend -> exchange_rate_api "Fetches current exchange rates" "JSON/HTTPS"

        # Relationships — frontend components
        admin -> ui_auth "Logs in via SSO or local account"
        project_manager -> ui_auth "Logs in via SSO"
        root -> ui_auth "Logs in with local account"
        ui_auth -> backend "POST /api/auth/login, GET /api/auth/callback" "JSON/HTTPS"
        ui_auth -> oidc_provider "OIDC Authorization Code Flow via NextAuth.js" "OIDC/HTTPS"

        admin -> ui_catalog "Browses infrastructure products"
        project_manager -> ui_catalog "Browses infrastructure products"
        ui_catalog -> backend "GET /api/catalog, GET /api/catalog/{id}" "JSON/HTTPS"

        admin -> ui_orders "Orders directly without approval"
        project_manager -> ui_orders "Places order, awaits approval"
        ui_orders -> backend "POST /api/orders, GET /api/orders, GET /api/orders/{id}" "JSON/HTTPS"

        admin -> ui_approvals "Reviews and decides on pending orders"
        ui_approvals -> backend "GET /api/approvals, POST /api/approvals/{id}/approve, POST /api/approvals/{id}/reject" "JSON/HTTPS"

        admin -> ui_infrastructure "Views all projects and infrastructure"
        root -> ui_infrastructure "Views all projects and infrastructure"
        project_manager -> ui_infrastructure "Views own projects and infrastructure"
        ui_infrastructure -> backend "GET /api/infrastructure, POST /api/infrastructure/{id}/decommission" "JSON/HTTPS"

        admin -> ui_audit "Views and exports the audit log"
        root -> ui_audit "Views and exports the audit log"
        ui_audit -> backend "GET /api/audit, GET /api/audit/export" "JSON/HTTPS"

        root -> ui_admin "Manages catalog, configuration and users"
        ui_admin -> backend "REST API calls to /api/admin/*" "JSON/HTTPS"

        admin -> ui_settings "Updates profile and password"
        project_manager -> ui_settings "Updates profile and password"
        ui_settings -> backend "GET /api/users/me, PUT /api/users/me, PUT /api/users/me/password" "JSON/HTTPS"

        # Relationships — backend components
        api_auth -> database "Verifies credentials, upserts SSO users, reads roles" "SQL/TCP"
        api_auth -> oidc_provider "Validates OIDC ID token" "OIDC/HTTPS"
        api_catalog -> database "Reads products, categories, translations, prices, exchange rates" "SQL/TCP"
        api_orders -> database "Creates and reads orders with parameters" "SQL/TCP"
        api_orders -> api_ci "Triggers provisioning pipeline for direct admin orders" "internal"
        api_orders -> api_notification "Triggers order received notification" "internal"
        api_orders -> api_audit "Logs order creation" "internal"
        api_approvals -> database "Reads pending orders, writes approval or rejection" "SQL/TCP"
        api_approvals -> api_ci "Triggers provisioning pipeline on approval" "internal"
        api_approvals -> api_notification "Triggers approval or rejection notification" "internal"
        api_approvals -> api_audit "Logs approval or rejection with comment" "internal"
        api_infrastructure -> database "Reads infrastructure elements, projects, environments" "SQL/TCP"
        api_infrastructure -> api_ci "Triggers destroy pipeline for decommissioning" "internal"
        api_infrastructure -> api_audit "Logs decommission request" "internal"
        api_admin -> database "CRUD for all catalog and configuration entities" "SQL/TCP"
        api_admin -> api_ci "Browses repositories, imports variables.tf" "internal"
        api_admin -> api_ai "Triggers AI translation for a product" "internal"
        api_admin -> api_exchange "Refreshes stored exchange rates" "internal"
        gitlab -> api_webhook "Pushes pipeline status events" "JSON/HTTPS"
        api_webhook -> database "Writes status transitions and OpenTofu outputs" "SQL/TCP"
        api_webhook -> api_ci "Fetches job trace to parse OpenTofu outputs on success" "internal"
        api_webhook -> api_notification "Triggers completion or failure notification" "internal"
        api_webhook -> api_audit "Logs pipeline status transition" "internal"
        api_audit -> database "Reads and writes audit entries" "SQL/TCP"
        api_notification -> smtp "Dispatches emails via Nodemailer" "SMTP"
        api_notification -> database "Reads recipient addresses" "SQL/TCP"
        api_ai -> ai_translation "Calls configured AI provider API" "JSON/HTTPS"
        api_exchange -> exchange_rate_api "Fetches current rates" "JSON/HTTPS"
        api_exchange -> database "Stores and reads cached rates" "SQL/TCP"
        api_ci -> gitlab "CI provider API calls (GitLab v4, GitHub REST, Bitbucket 2.0)" "JSON/HTTPS"

        # Deployment — Docker Host
        deploymentEnvironment "Docker Host" {
            deploymentNode "Docker Host" "Single server for local development and initial deployment" "Docker Engine" {
                deploymentNode "nginx" "HTTPS termination and reverse proxy. Routes / to frontend, /api/* to backend." "Docker Container / Nginx" {
                }
                deploymentNode "frontend" "Next.js frontend server" "Docker Container / Node.js" {
                    containerInstance frontend
                }
                deploymentNode "backend" "Next.js API server" "Docker Container / Node.js" {
                    containerInstance backend
                }
                deploymentNode "postgres" "Database" "Docker Container" {
                    containerInstance database
                }
            }
            deploymentNode "Entra ID (external)" "" "SaaS" {
                softwareSystemInstance oidc_provider
            }
            deploymentNode "GitLab (external)" "" "On-Premise / SaaS" {
                softwareSystemInstance gitlab
            }
            deploymentNode "Mail Server (external)" "" "On-Premise / SaaS" {
                softwareSystemInstance smtp
            }
            deploymentNode "Exchange Rate API (external)" "" "SaaS" {
                softwareSystemInstance exchange_rate_api
            }
        }

        # Deployment — Kubernetes
        deploymentEnvironment "Kubernetes" {
            deploymentNode "Kubernetes Cluster" "Production cluster" "Kubernetes" {
                deploymentNode "open-hybrid-cloud" "Application namespace" "Kubernetes Namespace" {
                    deploymentNode "Ingress + cert-manager" "HTTPS termination via Let's Encrypt or internal CA. Routes / to frontend service, /api/* to backend service." "Nginx Ingress / cert-manager" {
                    }
                    deploymentNode "frontend Deployment" "Next.js frontend pods, horizontally scalable." "Kubernetes Deployment" {
                        containerInstance frontend
                    }
                    deploymentNode "backend Deployment" "Next.js API pods, horizontally scalable. Stateless — all state in PostgreSQL. Receives inbound CI provider webhooks directly." "Kubernetes Deployment" {
                        containerInstance backend
                    }
                    deploymentNode "postgres StatefulSet" "PostgreSQL with persistent volume" "Kubernetes StatefulSet" {
                        containerInstance database
                    }
                }
            }
            deploymentNode "Entra ID (external)" "" "SaaS" {
                softwareSystemInstance oidc_provider
            }
            deploymentNode "GitLab (external)" "" "On-Premise / SaaS" {
                softwareSystemInstance gitlab
            }
            deploymentNode "Mail Server (external)" "" "On-Premise / SaaS" {
                softwareSystemInstance smtp
            }
            deploymentNode "Exchange Rate API (external)" "" "SaaS" {
                softwareSystemInstance exchange_rate_api
            }
        }
    }

    views {
        systemcontext webshop "SystemContext" {
            include *
            autoLayout
            description "System context: Open Hybrid Cloud and all external systems"
        }

        container webshop "Container" {
            include *
            autoLayout
            description "Container diagram: Next.js frontend, Next.js backend API and PostgreSQL database"
        }

        component frontend "Component_Frontend" {
            include *
            autoLayout
            description "Component diagram: Next.js frontend application"
        }

        component backend "Component_Backend" {
            include *
            autoLayout
            description "Component diagram: Next.js backend API"
        }

        deployment webshop "Docker Host" "Deployment_DockerHost" {
            include *
            autoLayout
            description "Deployment on a Docker host with Nginx for HTTPS"
        }

        deployment webshop "Kubernetes" "Deployment_Kubernetes" {
            include *
            autoLayout
            description "Deployment on Kubernetes with Ingress and cert-manager"
        }

        styles {
            element "Person" {
                color #ffffff
                background #08427b
                fontSize 22
                shape Person
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Existing System" {
                background #999999
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
        }
    }
}
