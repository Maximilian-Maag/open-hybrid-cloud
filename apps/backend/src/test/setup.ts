import { afterAll, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/lib/db/schema'
import { getTableName, sql } from 'drizzle-orm'
import { acquireTestDatabase } from './database'

// Claimed at MODULE scope, before any test file is imported: the app's db
// singleton reads process.env.DATABASE_URL when its module first loads, so a URL
// decided later in beforeAll would arrive too late to matter.
const acquired = await acquireTestDatabase(process.env.DATABASE_URL ?? '')
process.env.DATABASE_URL = acquired.url
console.warn(`[test] database: ${acquired.name}`)

// Module-level client for setup/teardown — tests use the app's db singleton.
const client = postgres(acquired.url)
export const testDb = drizzle(client, { schema })

// Every table the suite writes to. Order no longer matters for truncation (see
// TRUNCATE_ALL below), but it is kept dependency-ordered because it reads as the
// schema's shape and new tables get added in the right place by habit.
const TABLES = [
  schema.auditLog,
  schema.approvalDelegations,
  schema.sessions,
  schema.userRecoveryCodes,
  schema.userTotp,
  schema.productFavorites,
  schema.orderComments,
  schema.productVersions,
  schema.cartItems,
  schema.infrastructureElements,
  schema.orders,
  schema.pipelineStacks,
  schema.productWebhooks,
  schema.productEnvironmentSizes,
  schema.productEnvironments,
  schema.parameters,
  schema.productTranslations,
  schema.products,
  schema.categories,
  // Before deployment_environments: integrations.environment_id references it.
  schema.integrations,
  schema.deploymentEnvironments,
  schema.ciSources,
  schema.projects,
  schema.users,
  schema.costCenters,
  schema.exchangeRates,
] as const

beforeAll(async () => {
  // Push schema to test DB (idempotent — creates tables that don't exist)
  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','project_manager','root')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sso_sub TEXT UNIQUE,
      password_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Migration 0018: TOTP second factor for the local root account.
    CREATE TABLE IF NOT EXISTS user_totp (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret TEXT,
      pending_secret TEXT,
      pending_created_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      last_used_step BIGINT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_recovery_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_recovery_codes_user_id_code_hash_unique
      ON user_recovery_codes (user_id, code_hash);
    -- Migration 0019: server-side sessions with revocation (issue #37).
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS sessions_user_live_idx
      ON sessions (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INT NOT NULL DEFAULT 0
    );
    -- Migration 0017: a category holding an ordered product is retired, not deleted.
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      base_language TEXT NOT NULL DEFAULT 'de',
      image BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_mime TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_alt TEXT;
    -- Migration 0017: a product that has been ordered is retired, not deleted.
    ALTER TABLE products ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS product_translations (
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      language_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (product_id, language_code)
    );
    CREATE TABLE IF NOT EXISTS parameters (
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('global','category','product')),
      scope_id BIGINT NOT NULL DEFAULT 0,
      environment_id BIGINT,
      name TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK (type IN ('string','number','bool','dropdown')),
      description TEXT NOT NULL DEFAULT '',
      default_value TEXT NOT NULL DEFAULT '',
      required BOOLEAN NOT NULL DEFAULT FALSE,
      sensitive BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS ci_sources (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      access_token TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'gitlab' CHECK (provider IN ('gitlab','github','bitbucket'))
    );
    CREATE TABLE IF NOT EXISTS deployment_environments (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      ci_source_id BIGINT NOT NULL REFERENCES ci_sources(id),
      webhook_url TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      callback_secret TEXT NOT NULL DEFAULT ''
    );
    -- Older test DBs may not have callback_secret; add and backfill.
    ALTER TABLE deployment_environments ADD COLUMN IF NOT EXISTS callback_secret TEXT NOT NULL DEFAULT '';
    UPDATE deployment_environments SET callback_secret = webhook_token WHERE callback_secret = '';
    -- Migration 0006: the callback secret identifies the calling environment on
    -- an inbound callback, so it must be unique. Dropped first so re-running
    -- setup against an existing test DB is idempotent.
    ALTER TABLE deployment_environments
      DROP CONSTRAINT IF EXISTS deployment_environments_callback_secret_unique;
    ALTER TABLE deployment_environments
      ADD CONSTRAINT deployment_environments_callback_secret_unique UNIQUE (callback_secret);
    -- Migration 0023: the integration registry (issue #111). Placed after
    -- deployment_environments because environment_id references it.
    CREATE TABLE IF NOT EXISTS integrations (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('foreman','ansible','nexus','pulp','loki','grafana')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'bearer' CHECK (auth_type IN ('none','bearer','basic','token_header')),
      username TEXT NOT NULL DEFAULT '',
      credential TEXT,
      environment_id BIGINT REFERENCES deployment_environments(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      failure_mode TEXT NOT NULL DEFAULT 'best_effort' CHECK (failure_mode IN ('blocking','best_effort')),
      last_contacted_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS integrations_kind_env_key
      ON integrations (kind, environment_id) WHERE environment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS integrations_kind_global_key
      ON integrations (kind) WHERE environment_id IS NULL;
    CREATE INDEX IF NOT EXISTS integrations_kind_enabled_idx
      ON integrations (kind, enabled);
    CREATE TABLE IF NOT EXISTS product_environments (
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      cost_center_mode TEXT NOT NULL DEFAULT 'project' CHECK (cost_center_mode IN ('project','select','overhead')),
      forced_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (product_id, environment_id)
    );
    CREATE TABLE IF NOT EXISTS product_webhooks (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      exec_order INT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pipeline_stacks (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      state_key_param TEXT NOT NULL DEFAULT 'hostname',
      steps JSONB NOT NULL DEFAULT '[]'
    );
    -- Existing test DBs may have webhook_url/webhook_token columns; align with migration 0003.
    ALTER TABLE pipeline_stacks DROP COLUMN IF EXISTS webhook_url;
    ALTER TABLE pipeline_stacks DROP COLUMN IF EXISTS webhook_token;
    CREATE TABLE IF NOT EXISTS cost_centers (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    -- Added here rather than in the product_environments block above: the FK
    -- target has to exist first, and cost_centers is created after it.
    ALTER TABLE product_environments
      ADD COLUMN IF NOT EXISTS overhead_cost_center_id BIGINT
      REFERENCES cost_centers(id) ON DELETE SET NULL;
    -- Migration 0011: time-boxed trials.
    ALTER TABLE product_environments
      ADD COLUMN IF NOT EXISTS trial_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE product_environments
      ADD COLUMN IF NOT EXISTS trial_duration_minutes INTEGER NOT NULL DEFAULT 30;
    -- Migration 0020: t-shirt sizes per offering (issue #98). Declared here rather
    -- than with the other tables because the composite FK needs
    -- product_environments to exist first.
    CREATE TABLE IF NOT EXISTS product_environment_sizes (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL,
      environment_id BIGINT NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      sort_order INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT product_environment_sizes_offering_fk
        FOREIGN KEY (product_id, environment_id)
        REFERENCES product_environments(product_id, environment_id) ON DELETE CASCADE,
      CONSTRAINT product_environment_sizes_offering_code_unique
        UNIQUE (product_id, environment_id, code)
    );
    CREATE TABLE IF NOT EXISTS product_favorites (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_id BIGINT NOT NULL REFERENCES users(id),
      cost_center_id BIGINT REFERENCES cost_centers(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
      user_id BIGINT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      parameters JSONB NOT NULL DEFAULT '{}',
      cost_center_id BIGINT REFERENCES cost_centers(id),
      rejection_note TEXT,
      pipeline_id JSONB NOT NULL DEFAULT '[]',
      pipeline_status JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Older test DBs may not have pipeline_status; add it (migration 0005).
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS pipeline_status JSONB NOT NULL DEFAULT '{}';
    -- Migration 0011: the order carries the trial intent to approval time.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;
    -- Migration 0013: what the customer was offered when the order was placed.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_snapshot JSONB;
    -- Migration 0020: the order line is product × environment × size × quantity.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS size_code TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;
    CREATE TABLE IF NOT EXISTS cart_items (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id) ON DELETE CASCADE,
      parameters JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Migration 0020: a cart line carries its size and quantity.
    ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS size_code TEXT;
    ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;
    CREATE TABLE IF NOT EXISTS product_versions (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      environment_id BIGINT REFERENCES deployment_environments(id) ON DELETE SET NULL,
      changelog TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      snapshot JSONB,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_comments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      internal BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS infrastructure_elements (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id),
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      parameters JSONB NOT NULL DEFAULT '{}',
      outputs JSONB NOT NULL DEFAULT '{}',
      pipeline_id JSONB NOT NULL DEFAULT '[]',
      pipeline_status JSONB NOT NULL DEFAULT '{}',
      deployed_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- Older test DBs may not have pipeline_status; add it (migration 0007).
    ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS pipeline_status JSONB NOT NULL DEFAULT '{}';
    -- Migration 0010: scheduled automatic teardown.
    ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS scheduled_decommission_at TIMESTAMPTZ;
    -- Migration 0020: the element's own size, and which of the order's N it is.
    ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS size_code TEXT;
    ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS sequence INT NOT NULL DEFAULT 1;
    -- Migration 0025: what namespaces the element's Terraform state key. NULL is
    -- "provisioned before issue #183", so no default here either.
    ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS state_key_namespace TEXT;
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      action TEXT NOT NULL,
      entity_id BIGINT,
      details TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Migration 0022: out-of-office substitute approver (issue #35).
    CREATE TABLE IF NOT EXISTS approval_delegations (
      id BIGSERIAL PRIMARY KEY,
      from_user_id BIGINT NOT NULL REFERENCES users(id),
      to_user_id BIGINT NOT NULL REFERENCES users(id),
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      CONSTRAINT approval_delegations_period_check CHECK (ends_on >= starts_on),
      CONSTRAINT approval_delegations_not_self_check CHECK (from_user_id <> to_user_id)
    );
    CREATE INDEX IF NOT EXISTS approval_delegations_from_idx
      ON approval_delegations (from_user_id, starts_on, ends_on);
    CREATE INDEX IF NOT EXISTS approval_delegations_to_idx
      ON approval_delegations (to_user_id, starts_on, ends_on);
    CREATE TABLE IF NOT EXISTS exchange_rates (
      currency_code TEXT PRIMARY KEY,
      rate NUMERIC(18,6) NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS branding (
      id INT PRIMARY KEY DEFAULT 1,
      logo_data BYTEA,
      logo_mime TEXT,
      primary_color TEXT NOT NULL DEFAULT '#1e40af',
      secondary_color TEXT NOT NULL DEFAULT '#3b82f6',
      shop_name TEXT NOT NULL DEFAULT 'Open Hybrid Cloud',
      shop_subtitle TEXT NOT NULL DEFAULT '',
      imprint_text TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS app_config (
      id INT PRIMARY KEY DEFAULT 1,
      smtp_host TEXT,
      smtp_port INT,
      smtp_from TEXT,
      smtp_user TEXT,
      smtp_pass TEXT,
      smtp_tls BOOLEAN DEFAULT TRUE,
      ai_provider TEXT,
      ai_endpoint TEXT,
      ai_api_key TEXT,
      ai_model TEXT
    );
    INSERT INTO exchange_rates (currency_code, rate) VALUES ('EUR', 1.000000) ON CONFLICT DO NOTHING;
    INSERT INTO branding (id) VALUES (1) ON CONFLICT DO NOTHING;
    INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING;
  `)

  // Realign orders.product_id FK with schema.ts (ON DELETE CASCADE). Older
  // test databases created before this constraint change still have the
  // non-cascading FK, so drop-and-recreate keeps local dev in sync with CI.
  await testDb.execute(sql`
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;
    ALTER TABLE orders ADD CONSTRAINT orders_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  `)
})

/**
 * One statement for every table, not one statement per table.
 *
 * This runs before every one of ~1300 tests, and each `TRUNCATE` is its own
 * transaction waiting on its own commit — so the loop it replaces spent the suite
 * doing 26,000 round trips to Postgres. `TRUNCATE a, b, c` truncates them
 * together, in one transaction, and `CASCADE` no longer has anything to reach for
 * because every referencing table is already in the list. FK order stops
 * mattering for the same reason.
 */
const TRUNCATE_ALL = `TRUNCATE TABLE ${TABLES.map((table) => `"${getTableName(table)}"`).join(', ')} RESTART IDENTITY CASCADE`

beforeEach(async () => {
  await testDb.execute(sql.raw(TRUNCATE_ALL))
})

afterAll(async () => {
  await client.end()
  // Releases the advisory lock on this run's database, freeing the name for the
  // next run in this directory.
  await acquired.release()
})
