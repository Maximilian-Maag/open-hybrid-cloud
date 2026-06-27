workspace "Open Hybrid Cloud" "Self-service portal for ordering, managing and decommissioning IT infrastructure. Next.js frontend + REST API backend, PostgreSQL." {

    model {
        admin = person "Admin" "Views all orders and infrastructure, orders directly, approves or rejects project manager orders." "Person"
        root = person "Root" "Manages catalog, system config and users via a local account." "Person"
        project_manager = person "Project Manager" "Places orders (Admin approval required), manages own projects and infrastructure." "Person"

        gitlab = softwaresystem "GitLab" "CI provider executing OpenTofu workflows; pushes pipeline events back via webhook." "Existing System"
        oidc_provider = softwaresystem "Microsoft Entra ID" "SSO identity provider (OIDC) for admins and project managers." "Existing System"
        ai_translation = softwaresystem "AI Translation Service" "Optional AI provider for product content translation; supports cloud and on-premise models." "Existing System"
        smtp = softwaresystem "Mail Server" "SMTP server for transactional order and deployment notification emails." "Existing System"
        exchange_rate_api = softwaresystem "Exchange Rate API" "Provides current exchange rates for per-locale currency conversion." "Existing System"

        webshop = softwaresystem "Open Hybrid Cloud" "Self-service portal for ordering, managing and decommissioning IT infrastructure." {

            frontend = container "Frontend" "React UI; server-side rendered with NextAuth.js sessions, communicates with Backend API via REST." "Next.js / React / Tailwind CSS / NextAuth.js" {

                ui_auth = component "Auth Pages" "Login with local credentials or SSO (OIDC); JWT in HttpOnly cookie forwarded to Backend."
                ui_catalog = component "Catalog" "Filtered product grid with locale currency prices; environment and parameter selection for ordering."
                ui_orders = component "Orders" "Order form with dynamic parameters, project/cost-centre assignment and live status polling."
                ui_approvals = component "Approvals" "Pending order queue for admins with inline approve/reject actions."
                ui_infrastructure = component "Infrastructure" "Infrastructure items grouped by project/environment; shows outputs and decommission trigger."
                ui_audit = component "Audit Log" "Filterable compliance log with CSV/PDF export."
                ui_admin = component "Administration" "Manages catalog entities, environments, CI sources, users, branding and system config."
                ui_settings = component "Settings" "User profile update and password change."
            }

            backend = container "Backend API" "RESTful API with all business logic; purely functional, Zod-validated, Drizzle ORM, OpenAPI docs at /api/docs." "Next.js / TypeScript / Drizzle ORM / Zod / JWT" {

                api_auth = component "Auth API" "Local and OIDC login issuing signed JWTs; middleware enforces role hierarchy on all routes."
                api_catalog = component "Catalog API" "Paginated, filterable product list with details, prices and images."
                api_orders = component "Orders API" "Creates and reads orders; admin orders auto-approve and trigger CI pipeline immediately."
                api_approvals = component "Approvals API" "Lists pending orders; approve triggers CI pipeline, reject stores comment and notifies."
                api_infrastructure = component "Infrastructure API" "Lists infrastructure by role; decommission triggers CI destroy pipeline."
                api_admin = component "Administration API" "Full CRUD for catalog, environments, CI sources, users and system config; repo browser and variables.tf import."
                api_webhook = component "CI Webhook Receiver" "Receives CI provider pipeline events, verifies signatures, parses outputs and transitions order/infra status."
                api_audit = component "Audit API" "Writes immutable audit entries; filterable log with CSV/PDF export for admins."
                api_notification = component "Notification" "Sends transactional emails for order and deployment lifecycle events via Nodemailer."
                api_ai = component "AI Translation" "Translates product content into 25 languages via the configured AI provider."
                api_exchange = component "Exchange Rates" "Fetches and caches exchange rates; converts amounts between currencies."
                api_ci = component "CI Provider Client" "Unified client for GitLab, GitHub and Bitbucket: trigger pipelines, browse repos, fetch job traces."
                api_docs = component "OpenAPI / Swagger UI" "Swagger UI and OpenAPI 3.0 spec auto-generated from Zod schemas."
            }

            database = container "Database" "Stores all portal data: catalog, orders, infrastructure, users, audit log, config and branding." "PostgreSQL 16" "Database"
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
                    deploymentNode "backend Deployment" "Next.js API pods, horizontally scalable. Stateless — all state in PostgreSQL." "Kubernetes Deployment" {
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
