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

            backend = container "Backend API" "RESTful API; thin route handlers delegate to a typed service layer; Zod-validated inputs; Result<T> error handling; OpenAPI docs at /api/docs." "Next.js / TypeScript / Drizzle ORM / Zod / JWT" {

                api_auth = component "Auth Routes" "Thin HTTP shell: parse credentials or OIDC callback, call auth service, return signed JWT."
                api_catalog = component "Catalog Routes" "Thin HTTP shell: parse language/filter params, call catalog service."
                api_orders = component "Order Routes" "Thin HTTP shell: validate body, call orders or approvals service."
                api_infrastructure = component "Infrastructure Routes" "Thin HTTP shell: call infrastructure service for list and decommission."
                api_admin = component "Admin Routes" "Thin HTTP shells for catalog, environments, CI sources, users and config — each delegates to its service."
                api_webhook = component "CI Webhook Receiver" "Verifies provider signature/token; calls handlePipelineEvent to transition order/infra state and parse OpenTofu outputs."
                api_audit = component "Audit Routes" "Thin HTTP shell: call audit service for filterable log and CSV/PDF export."
                svc_orders = component "Orders Service" "State machine: pending → provisioning → completed/failed/rejected. Calls CI trigger, writes audit, sends emails."
                svc_approvals = component "Approvals Service" "Approve (triggers CI, creates infra element) and reject (stores note, notifies orderer)."
                svc_infrastructure = component "Infrastructure Service" "Ownership check, status guard, CI destroy trigger, audit write."
                svc_admin = component "Admin Services" "One service per domain: users, products, categories, environments, ciSources, parameters, costCenters, exchangeRates, config, branding, pipelineStacks."
                svc_auth = component "Auth Service" "Bcrypt credential verify, SSO user upsert, JWT issue. Returns Result<T>."
                lib_queries = component "Query Helpers" "Shared DB reads used across services: findProductName, findUserEmail, findAdminEmails, findCiSourceForEnv."
                lib_result = component "Result<T> / toResponse" "Ok<T>|Err discriminated union; toResponse() maps Result to NextResponse."
                api_notification = component "Notification" "Seven typed send functions; HTML-escapes all user strings before embedding in email bodies."
                api_ai = component "AI Translation" "Translates product content into 25 languages via the configured AI provider."
                api_exchange = component "Exchange Rates" "Fetches and caches exchange rates; converts amounts between currencies."
                api_ci = component "CI Provider Client" "Unified client for GitLab, GitHub and Bitbucket: trigger pipelines, browse repos, fetch job traces. triggerProductWebhooks() orchestrates webhook execOrder; triggerPipelineStacks() sends ordered stack steps as PIPELINE_STACK JSON to the CI orchestrator."
                api_docs = component "OpenAPI / Swagger UI" "Swagger UI and OpenAPI 3.0 spec auto-generated from Zod schemas."
            }

            database = container "Database" "Stores all portal data: catalog, orders, infrastructure, users, audit log, config, branding and pipeline stacks." "PostgreSQL 16" "Database"
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
        # Route handler → service
        api_auth -> svc_auth "Delegates credential/SSO logic" "internal"
        api_orders -> svc_orders "Delegates order creation" "internal"
        api_orders -> svc_approvals "Delegates approve/reject" "internal"
        api_infrastructure -> svc_infrastructure "Delegates list and decommission" "internal"
        api_admin -> svc_admin "Delegates all CRUD operations" "internal"
        api_audit -> lib_queries "Uses shared query helpers" "internal"

        # Services → shared libraries
        svc_orders -> api_ci "triggerProductWebhooks, triggerPipelineStacks" "internal"
        svc_orders -> api_notification "sendOrderCreated, sendApprovalRequest" "internal"
        svc_orders -> lib_queries "findProductName, findUserEmail, findAdminEmails" "internal"
        svc_approvals -> api_ci "triggerProductWebhooks, triggerPipelineStacks" "internal"
        svc_approvals -> api_notification "sendOrderApproved, sendOrderRejected" "internal"
        svc_approvals -> lib_queries "findProductName, findUserEmail" "internal"
        svc_infrastructure -> api_ci "triggerProductWebhooks with TF_ACTION=destroy" "internal"
        svc_infrastructure -> lib_queries "findCiSourceForEnv" "internal"
        svc_auth -> oidc_provider "Validates OIDC ID token" "OIDC/HTTPS"
        svc_admin -> api_ai "Triggers AI translation for a product" "internal"
        svc_admin -> api_exchange "Refreshes stored exchange rates" "internal"
        svc_admin -> api_ci "Browses repositories, imports variables.tf" "internal"

        # Webhook handler
        gitlab -> api_webhook "Pushes pipeline status events" "JSON/HTTPS"
        api_webhook -> database "Writes status transitions and OpenTofu outputs" "SQL/TCP"
        api_webhook -> api_ci "Fetches job trace to parse OpenTofu outputs on success" "internal"
        api_webhook -> api_notification "Triggers completion or failure notification" "internal"
        api_webhook -> lib_queries "findProductName, findUserEmail, findCiSourceForEnv" "internal"

        # External I/O
        api_notification -> smtp "Dispatches emails via Nodemailer" "SMTP"
        api_ai -> ai_translation "Calls configured AI provider API" "JSON/HTTPS"
        api_exchange -> exchange_rate_api "Fetches current rates" "JSON/HTTPS"
        api_exchange -> database "Stores and reads cached rates" "SQL/TCP"
        api_ci -> gitlab "CI provider API calls (GitLab v4, GitHub REST, Bitbucket 2.0)" "JSON/HTTPS"

        # DB access (all services and helpers)
        svc_auth -> database "Reads and writes users" "SQL/TCP"
        svc_orders -> database "Reads and writes orders, infra elements" "SQL/TCP"
        svc_approvals -> database "Reads and writes orders, infra elements" "SQL/TCP"
        svc_infrastructure -> database "Reads and writes infra elements, projects" "SQL/TCP"
        svc_admin -> database "CRUD for all catalog and configuration entities" "SQL/TCP"
        lib_queries -> database "Shared read queries" "SQL/TCP"

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
