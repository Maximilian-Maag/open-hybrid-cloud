workspace "Infra-Webshop" "Self-service portal for ordering, managing and decommissioning IT infrastructure. Go + HTMX, single container." {

    model {
        du_admin = person "Admin" "Administrator. Can view all orders, projects and infrastructure, order directly and approve or reject orders from project leaders." "Person"
        shop_admin = person "Webshop Admin" "Manages the product catalog, system configuration and local user accounts. Can view all projects and infrastructure. Uses a local account." "Person"
        project_leader = person "Project Leader" "Can place orders (approval by Admin required), decommission own infrastructure and manage projects. Can only view own projects, orders and infrastructure." "Person"

        gitlab = softwaresystem "GitLab" "Multiple configurable GitLab instances as sources for OpenTofu modules. Receives provisioning and destroy webhooks, executes OpenTofu workflows and provides an API for the repository browser and pipeline status." "Existing System"
        oidc_provider = softwaresystem "Microsoft Entra ID" "SSO identity provider (OIDC) for authenticating admins and project leaders." "Existing System"
        ai_translation = softwaresystem "AI Translation Service" "Configurable AI provider for translating product content into all EU languages and Russian. Cloud: Claude, OpenAI, Azure OpenAI. On-premise: Ollama, LocalAI. Optional — hidden when not configured." "Existing System"
        smtp = softwaresystem "Mail Server" "SMTP server for transactional emails: order confirmation, approval request, approval/rejection, deployment completion and error notifications." "Existing System"
        exchange_rate_api = softwaresystem "Exchange Rate API" "External API for current exchange rates. Used to convert from the configured base currency to the display currency per user locale." "Existing System"

        webshop = softwaresystem "Infra-Webshop" "Self-service portal through which admins and project leaders can order, manage and decommission IT infrastructure." {

            app = container "Webshop" "Go server that renders HTML templates server-side and delivers them as fragments via HTMX. Contains UI, business logic, GitLab integration and all background processes in a single stateless container." "Go / HTMX / Tailwind / DaisyUI" {

                auth = component "Authentication" "OIDC login via Entra ID (Authorization Code Flow) for admins and project leaders. Local account login for Webshop Admin. Manages sessions and roles in an encrypted HttpOnly cookie."

                catalog = component "Product Catalog" "Displays infrastructure products by category with image, multilingual description and price. Price shown in the user's locale currency — converted from the base currency using stored exchange rates. When ordering: selection of the available deployment environment, display of environment-specific parameters."

                order = component "Order" "Order form with dynamically generated parameters from global, category and product parameter sets as well as environment-specific parameters. Project assignment and cost centre assignment per line item. Admins deploy directly via provisioning webhook. Project leader orders await approval."

                approval = component "Approval" "Overview of pending orders from project leaders for admins. Any admin can approve or reject. Rejection requires a mandatory comment. Approval triggers the GitLab provisioning webhook."

                infrastructure = component "Infrastructure Overview" "Displays deployed infrastructure items grouped by project and deployment environment. Admin and Webshop Admin see everything, project leaders see only their own. Decommissioning via GitLab destroy webhook. Existing project usable as an order template."

                status = component "Order Status" "Delivers HTMX polling fragments for the live status of running provisioning and decommissioning workflows."

                audit = component "Audit Log" "Immutable compliance record of all actions: order, approval, rejection with comment, deployment, decommissioning. Viewable and filterable by Admin and Webshop Admin. Export as CSV or PDF."

                notification = component "Notification" "Sends transactional emails. Order received: confirmation to the orderer and approval request to all admins (project leaders only). Approval or rejection with comment: to the orderer. Deployment completed: to the orderer. Deployment failed: to the orderer and all admins. Decommissioning completed: to the orderer."

                admin = component "Administration" "Management of: product categories, products (image, multilingual content, parameter sets, prices per product and environment, cost centre configuration per product), global parameter sets, GitLab sources (URL and token per instance), deployment environments, cost centre list, base currency, AI provider configuration, SMTP configuration and local user accounts. Browses repositories on configured GitLab sources via the GitLab API and imports variables.tf files for product parameters (HCL parser). Shop branding management: logo upload (PNG/SVG, stored as BYTEA), primary color (header/footer), accent color (buttons), shop name, subtitle and imprint text — all stored in DB and cached in-process."

                polling = component "GitLab Polling" "Goroutine pool that periodically queries the GitLab API for pipeline status, updates order and infrastructure status and triggers notifications on status changes. Coordinated via PostgreSQL locks — safe with multiple container replicas. Tracks multiple concurrent GitLab pipeline IDs per order (JSONB array)."
            }

            database = container "Database" "Persistence of all webshop data: product categories, products (image as bytea, webhook reference), product translations (per language code), parameter sets (global, category, product, environment), GitLab sources, deployment environments, prices per product and environment, cost centres, exchange rates, projects (with cost centre), orders (including approval workflow and rejection comment), infrastructure items, pipeline IDs as JSONB array (multiple concurrent pipelines per order), audit log, local users, branding (logo as BYTEA, colors, shop name, imprint text) and product webhooks (multiple per product+environment, ordered by exec_order)." "PostgreSQL" "Database"
        }

        # Relationships between persons and systems
        du_admin -> webshop "Orders IT infrastructure directly, approves orders, monitors all projects"
        shop_admin -> webshop "Manages product catalog, system configuration and users"
        project_leader -> webshop "Orders and manages own IT infrastructure"
        webshop -> gitlab "Browses repositories, triggers webhooks, polls pipeline status" "JSON/HTTPS"
        webshop -> oidc_provider "Authenticates admins and project leaders" "OIDC/HTTPS"
        webshop -> ai_translation "Translates product content (optional, configurable)" "JSON/HTTPS"
        webshop -> smtp "Sends transactional emails" "SMTP"
        webshop -> exchange_rate_api "Fetches current exchange rates" "JSON/HTTPS"

        # Relationships between containers
        du_admin -> app "Uses web interface" "HTTPS"
        shop_admin -> app "Manages shop" "HTTPS"
        project_leader -> app "Uses web interface" "HTTPS"
        app -> database "Reads and writes data" "SQL/TCP"
        app -> gitlab "Trigger webhooks, browse repositories, poll pipeline status" "JSON/HTTPS"
        app -> oidc_provider "OIDC Authorization Code Flow" "HTTPS"
        app -> ai_translation "AI translation (optional)" "JSON/HTTPS"
        app -> smtp "Send emails" "SMTP"
        app -> exchange_rate_api "Fetch exchange rates" "JSON/HTTPS"

        # Relationships between components
        du_admin -> auth "Logs in via SSO"
        project_leader -> auth "Logs in via SSO"
        shop_admin -> auth "Logs in with local account"
        auth -> oidc_provider "Authorization Code Flow" "OIDC/HTTPS"
        auth -> database "Reads users and roles, writes sessions"

        du_admin -> catalog "Browses infrastructure products"
        project_leader -> catalog "Browses infrastructure products"
        catalog -> database "Reads products, categories, prices and exchange rates"

        du_admin -> order "Orders directly without approval"
        project_leader -> order "Places order, order awaits approval"
        order -> database "Stores order with parameters, project assignment and cost centres"
        order -> gitlab "Triggers provisioning webhook (direct order by Admin)" "JSON/HTTPS"
        order -> notification "Triggers order received notifications"
        order -> audit "Logs the order"

        du_admin -> approval "Reviews and decides on pending orders"
        approval -> database "Reads pending orders, writes approval or rejection with comment"
        approval -> gitlab "Triggers provisioning webhook after approval" "JSON/HTTPS"
        approval -> notification "Triggers approval or rejection notification"
        approval -> audit "Logs approval or rejection with comment"

        du_admin -> infrastructure "Views all projects and infrastructure"
        shop_admin -> infrastructure "Views all projects and infrastructure"
        project_leader -> infrastructure "Views only own projects and infrastructure"
        infrastructure -> database "Reads infrastructure items, projects and environments"
        infrastructure -> gitlab "Triggers destroy webhook for decommissioning" "JSON/HTTPS"
        infrastructure -> audit "Logs the decommissioning"

        du_admin -> status "Tracks deployment status"
        project_leader -> status "Tracks status of own deployments"
        status -> database "Reads pipeline status"

        du_admin -> audit "Views and exports the audit log"
        shop_admin -> audit "Views and exports the audit log"
        audit -> database "Reads and writes audit entries"

        notification -> smtp "Sends emails" "SMTP"
        notification -> database "Reads recipient addresses, logs sent messages"

        shop_admin -> admin "Manages catalog, configuration and users"
        admin -> database "CRUD products, categories, parameters, environments, GitLab sources, cost centres, currencies, users"
        admin -> gitlab "Browses repositories and reads variables.tf for product parameters" "JSON/HTTPS"
        admin -> ai_translation "Triggers optional AI translation" "JSON/HTTPS"
        admin -> exchange_rate_api "Updates stored exchange rates" "JSON/HTTPS"

        polling -> gitlab "Polls pipeline status of all running workflows" "JSON/HTTPS"
        polling -> database "Updates order and infrastructure status"
        polling -> notification "Triggers notifications on status changes"
        polling -> audit "Logs status transitions"

        deploymentEnvironment "Docker Host" {
            deploymentNode "Docker Host" "Single server for local development and initial deployment" "Docker Engine" {
                deploymentNode "nginx" "HTTPS termination and reverse proxy" "Docker Container / Nginx" {
                }
                deploymentNode "webshop" "Go webshop server" "Docker Container" {
                    containerInstance app
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

        deploymentEnvironment "Kubernetes" {
            deploymentNode "Kubernetes Cluster" "Production cluster" "Kubernetes" {
                deploymentNode "open-hybrid-cloud" "Application namespace" "Kubernetes Namespace" {
                    deploymentNode "Ingress + cert-manager" "HTTPS termination via Let's Encrypt or internal CA. Routes external traffic to the webshop service." "Nginx Ingress / cert-manager" {
                    }
                    deploymentNode "webshop Deployment" "Stateless Go pods, horizontally scalable. Polling coordinated via PostgreSQL locks." "Kubernetes Deployment" {
                        containerInstance app
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
            description "System context: Infra-Webshop and all external systems"
        }

        container webshop "Container" {
            include *
            autoLayout
            description "Container diagram: Go webshop server and PostgreSQL database"
        }

        component app "Component_App" {
            include *
            autoLayout
            description "Component diagram: Go webshop server"
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
