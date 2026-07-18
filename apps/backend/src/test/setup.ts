import { afterAll, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

// Module-level client for setup/teardown — tests use the app's db singleton
const client = postgres(process.env.DATABASE_URL ?? '')
export const testDb = drizzle(client, { schema })

// Tables in dependency order so truncation respects FKs
const TABLES = [
  schema.auditLog,
  schema.infrastructureElements,
  schema.orders,
  schema.pipelineStacks,
  schema.productWebhooks,
  schema.productEnvironments,
  schema.parameters,
  schema.productTranslations,
  schema.products,
  schema.categories,
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
    CREATE TABLE IF NOT EXISTS categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      base_language TEXT NOT NULL DEFAULT 'de',
      image BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
      webhook_token TEXT NOT NULL
    );
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
      webhook_url TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      state_key_param TEXT NOT NULL DEFAULT 'hostname',
      steps JSONB NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS cost_centers (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
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
      product_id BIGINT NOT NULL REFERENCES products(id),
      environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
      user_id BIGINT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      parameters JSONB NOT NULL DEFAULT '{}',
      cost_center_id BIGINT REFERENCES cost_centers(id),
      rejection_note TEXT,
      pipeline_id JSONB NOT NULL DEFAULT '[]',
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
      deployed_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      action TEXT NOT NULL,
      entity_id BIGINT,
      details TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
})

beforeEach(async () => {
  // Truncate all tables in safe order before each test
  for (const table of TABLES) {
    await testDb.execute(sql`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`)
  }
})

afterAll(async () => {
  await client.end()
})
