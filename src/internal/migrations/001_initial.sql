-- 001_initial.sql: Complete initial schema (consolidated)

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'project_manager', 'root')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    sso_sub       TEXT UNIQUE,
    password_hash TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT local_account_has_password CHECK (sso_sub IS NOT NULL OR password_hash IS NOT NULL)
);

CREATE TABLE categories (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE products (
    id            BIGSERIAL PRIMARY KEY,
    category_id   BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    base_language TEXT NOT NULL DEFAULT 'de',
    image         BYTEA,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_translations (
    product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (product_id, language_code)
);

CREATE TABLE parameters (
    id             BIGSERIAL PRIMARY KEY,
    scope          TEXT NOT NULL CHECK (scope IN ('global', 'category', 'product')),
    scope_id       BIGINT NOT NULL DEFAULT 0,
    environment_id BIGINT,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('string', 'number', 'bool', 'dropdown')),
    description    TEXT NOT NULL DEFAULT '',
    default_value  TEXT NOT NULL DEFAULT '',
    required       BOOLEAN NOT NULL DEFAULT FALSE,
    sensitive      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE ci_sources (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    access_token TEXT NOT NULL,
    provider     TEXT NOT NULL DEFAULT 'gitlab' CHECK (provider IN ('gitlab', 'github', 'bitbucket'))
);

CREATE TABLE deployment_environments (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    ci_source_id  BIGINT NOT NULL REFERENCES ci_sources(id),
    webhook_url   TEXT NOT NULL,
    webhook_token TEXT NOT NULL
);

CREATE TABLE product_environments (
    product_id         BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    environment_id     BIGINT NOT NULL REFERENCES deployment_environments(id),
    price              NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency           TEXT NOT NULL DEFAULT 'EUR',
    cost_center_mode   TEXT NOT NULL DEFAULT 'project' CHECK (cost_center_mode IN ('project', 'select', 'overhead')),
    forced_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (product_id, environment_id)
);

CREATE TABLE product_webhooks (
    id             BIGSERIAL PRIMARY KEY,
    product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
    name           TEXT NOT NULL,
    webhook_url    TEXT NOT NULL,
    webhook_token  TEXT NOT NULL,
    exec_order     INT NOT NULL DEFAULT 0
);

CREATE TABLE cost_centers (
    id     BIGSERIAL PRIMARY KEY,
    code   TEXT NOT NULL UNIQUE,
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE projects (
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    owner_id       BIGINT NOT NULL REFERENCES users(id),
    cost_center_id BIGINT REFERENCES cost_centers(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
    user_id        BIGINT NOT NULL REFERENCES users(id),
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'completed', 'failed', 'rejected')),
    parameters     JSONB NOT NULL DEFAULT '{}',
    cost_center_id BIGINT REFERENCES cost_centers(id),
    rejection_note TEXT,
    pipeline_id    JSONB NOT NULL DEFAULT '[]',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE infrastructure_elements (
    id             BIGSERIAL PRIMARY KEY,
    order_id       BIGINT NOT NULL REFERENCES orders(id),
    project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
    product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'decommissioning', 'decommissioned')),
    parameters     JSONB NOT NULL DEFAULT '{}',
    pipeline_id    JSONB NOT NULL DEFAULT '[]',
    outputs        JSONB NOT NULL DEFAULT '{}',
    deployed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE exchange_rates (
    currency_code TEXT PRIMARY KEY,
    rate          NUMERIC(18,6) NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO exchange_rates (currency_code, rate) VALUES ('EUR', 1.000000);

CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT REFERENCES users(id),
    action     TEXT NOT NULL,
    entity_id  BIGINT,
    details    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branding (
    id              INT PRIMARY KEY DEFAULT 1,
    logo_data       BYTEA,
    logo_mime       TEXT,
    primary_color   TEXT NOT NULL DEFAULT '#1e40af',
    secondary_color TEXT NOT NULL DEFAULT '#3b82f6',
    shop_name       TEXT NOT NULL DEFAULT 'Open Hybrid Cloud',
    shop_subtitle   TEXT NOT NULL DEFAULT '',
    imprint_text    TEXT NOT NULL DEFAULT ''
);

INSERT INTO branding (id) VALUES (1);

CREATE TABLE app_config (
    id           INT PRIMARY KEY DEFAULT 1,
    smtp_host    TEXT,
    smtp_port    INT,
    smtp_from    TEXT,
    smtp_user    TEXT,
    smtp_pass    TEXT,
    smtp_tls     BOOLEAN DEFAULT TRUE,
    ai_provider  TEXT,
    ai_endpoint  TEXT,
    ai_api_key   TEXT,
    ai_model     TEXT
);

INSERT INTO app_config (id) VALUES (1);

-- Indexes
CREATE INDEX idx_products_category   ON products(category_id);
CREATE INDEX idx_orders_user         ON orders(user_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_project      ON orders(project_id);
CREATE INDEX idx_infra_project       ON infrastructure_elements(project_id);
CREATE INDEX idx_infra_status        ON infrastructure_elements(status);
CREATE INDEX idx_projects_owner      ON projects(owner_id);
CREATE INDEX idx_audit_user          ON audit_log(user_id);
CREATE INDEX idx_audit_action        ON audit_log(action);
CREATE INDEX idx_parameters_scope    ON parameters(scope, scope_id);
