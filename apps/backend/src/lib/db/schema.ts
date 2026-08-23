import {
  pgTable,
  bigserial,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  date,
  primaryKey,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { StackStep } from '@open-hybrid-cloud/types'
import type { ProductSnapshot } from '@/lib/services/snapshot'

const bytea = customType<{ data: Buffer }>({
  dataType() { return 'bytea' },
})

export const users = pgTable('users', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  role: text({ enum: ['admin', 'project_manager', 'root'] }).notNull(),
  active: boolean().notNull().default(true),
  ssoSub: text('sso_sub').unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Server-side session records (issue #37).
//
// Sessions used to be nothing but a signed JWT: no way to see them, and no way to
// end one short of rotating JWT_SECRET, which signs everybody out. A row per
// session makes both possible - the JWT carries this row's id as its `sid` claim
// and every authenticated request checks the row before it does anything else.
//
// The token itself is never stored, only its SHA-256. A leaked database dump must
// not hand out working session tokens, and the hash is enough for what the check
// needs: proving the presented token is the one this row was issued for.
export const sessions = pgTable('sessions', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  // Both nullable: without a trusted proxy there is no reliable client address
  // (see TRUST_PROXY in lib/auth/requestMeta.ts), and a scripted client sends no
  // User-Agent. NULL says "not recorded", which is honest; '-' would be a value
  // every reader then has to special-case anyway.
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Advanced at most once per SESSION_TOUCH_INTERVAL_MS, not on every request -
  // see lib/auth/sessions.ts. "Last active, to within five minutes" is what the
  // session list needs; a write per request is not.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  // Mirrors the JWT's own `exp`. Duplicated deliberately: the list has to show a
  // lifetime without decoding a token it does not hold, and the request check
  // must reject an expired row even when the signature still verifies.
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Set, never deleted: a revoked session is evidence, and the audit entry that
  // records the revocation points at a row that has to still be there.
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const categories = pgTable('categories', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  /**
   * When the category was retired, or null while it is live.
   *
   * The same rule as `products.retiredAt`, one level up: `products.category_id` is
   * ON DELETE CASCADE, so deleting a category deleted its products and cascaded
   * their orders away with them. A category holding an ordered product is retired
   * along with that product, so it survives as the `category_id` the retired rows
   * point at.
   */
  retiredAt: timestamp('retired_at', { withTimezone: true }),
})

export const products = pgTable('products', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  categoryId: bigint('category_id', { mode: 'number' }).notNull().references(() => categories.id, { onDelete: 'cascade' }),
  baseLanguage: text('base_language').notNull().default('de'),
  image: bytea('image'),
  /** MIME type of `image`. Null on rows written before it was recorded. */
  imageMime: text('image_mime'),
  /**
   * What the picture shows, for the `alt` attribute (WCAG 1.1.1).
   *
   * Required whenever `image` is set — enforced in the service, because the column
   * cannot express "not null only when another column is not null" without a table
   * constraint that would break the legacy rows the migration backfills.
   */
  imageAlt: text('image_alt'),
  /**
   * When the product was retired from the catalogue, or null while it is live.
   *
   * A product that has been ordered cannot be deleted: `orders.product_id` is ON
   * DELETE CASCADE, so the delete took the order history — and its
   * `product_snapshot` — with it (issue #142). Retiring keeps the row as the
   * referent its orders need; `deleteProduct` withdraws every environment offering
   * at the same time, and cart-add and order creation both require an offering, so
   * nothing can be ordered from a retired product. Products that were never
   * ordered are still deleted outright.
   */
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const productTranslations = pgTable('product_translations', {
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  languageCode: text('language_code').notNull(),
  name: text().notNull(),
  description: text().notNull().default(''),
}, (t) => [primaryKey({ columns: [t.productId, t.languageCode] })])

export const parameters = pgTable('parameters', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  scope: text({ enum: ['global', 'category', 'product'] }).notNull(),
  scopeId: bigint('scope_id', { mode: 'number' }).notNull().default(0),
  environmentId: bigint('environment_id', { mode: 'number' }),
  name: text().notNull(),
  label: text().notNull().default(''),
  type: text({ enum: ['string', 'number', 'bool', 'dropdown'] }).notNull(),
  description: text().notNull().default(''),
  defaultValue: text('default_value').notNull().default(''),
  required: boolean().notNull().default(false),
  sensitive: boolean().notNull().default(false),
})

export const ciSources = pgTable('ci_sources', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  url: text().notNull(),
  accessToken: text('access_token').notNull(),
  provider: text({ enum: ['gitlab', 'github', 'bitbucket'] }).notNull().default('gitlab'),
})

/** Every external system the registry below can hold. */
export const INTEGRATION_KINDS = ['foreman', 'ansible', 'nexus', 'pulp', 'loki', 'grafana'] as const

/** How the portal authenticates to an integration. */
export const INTEGRATION_AUTH_TYPES = ['none', 'bearer', 'basic', 'token_header'] as const

/** What a failed call to an integration means for the operation that made it. */
export const INTEGRATION_FAILURE_MODES = ['blocking', 'best_effort'] as const

/**
 * Registry of external systems the portal talks to that are NOT CI providers
 * (issue #111): Foreman (#112), Ansible/AWX (#113), Nexus and Pulp (#114),
 * Loki (#116) and Grafana (#117).
 *
 * DELIBERATELY BESIDE `ci_sources`, NOT THROUGH IT. None of the six is a CI
 * provider, so widening the `provider` enum would leave a column that no longer
 * means anything and six rows that half-fit. Migrating `ci_sources` onto this
 * table is a decision that was TAKEN AND DEFERRED, not overlooked: `ci_sources`
 * is referenced by `deployment_environments.ci_source_id`, read by the whole
 * `lib/ci` client layer and exposed by the CI-browser endpoints, so folding it
 * in is a migration with a blast radius, and it is out of scope for #111. What
 * this table does establish is the substrate that migration would land on —
 * encrypted credentials, health, failure semantics — so the eventual move is a
 * data migration rather than a redesign.
 */
export const integrations = pgTable('integrations', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  kind: text({ enum: INTEGRATION_KINDS }).notNull(),
  /** Operator-facing label. Shown in errors, so it should say which instance. */
  name: text().notNull(),
  baseUrl: text('base_url').notNull(),
  authType: text('auth_type', { enum: INTEGRATION_AUTH_TYPES }).notNull().default('bearer'),
  /**
   * Username for `basic` auth. Plain text on purpose — it is not a secret, and
   * keeping it readable means the admin UI can show *which* account is
   * configured without a decrypt round trip.
   */
  username: text().notNull().default(''),
  /**
   * The token or password, AES-256-GCM encrypted (see lib/crypto/secrets.ts for
   * the envelope). Never selected by the list/get paths and never returned by
   * the API — the only reader is `resolveIntegration`, which hands it to the
   * probe or to a future client.
   *
   * Nullable so `auth_type = 'none'` (an unauthenticated Loki, a public Grafana
   * health endpoint) does not have to store an empty ciphertext, and so a row
   * can outlive a credential that was revoked.
   */
  credential: text(),
  /**
   * Which deployment environment this instance serves. NULL means portal-wide —
   * one Loki or one Grafana for the whole installation is the normal case, while
   * Foreman and Nexus are usually per-environment.
   *
   * CASCADE: an integration bound to a deleted environment has nothing left to
   * serve, and `deleteEnvironment` refuses on any non-cascading reference, so a
   * plain FK here would make environments undeletable once one was configured.
   */
  environmentId: bigint('environment_id', { mode: 'number' }).references(() => deploymentEnvironments.id, { onDelete: 'cascade' }),
  /**
   * Off without being deleted. A misbehaving integration has to be switchable
   * off in one field: deleting it loses the URL and the credential, and every
   * consumer would then have to treat "absent" and "deliberately disabled" as
   * the same thing — which is how a blocking integration silently becomes
   * best-effort.
   */
  enabled: boolean().notNull().default(true),
  /**
   * Whether a failed call to this integration blocks the operation that made it
   * (`blocking`) or is logged and carried on from (`best_effort`) — issue #111's
   * fifth bullet, in the data model rather than re-decided at each call site.
   *
   * The DB default is `best_effort` because that is the only safe answer for a
   * row written by a migration that cannot know the intent. The API does NOT
   * default it: create requires the field, so nobody gets best-effort by not
   * thinking about it, which is precisely how the trial and webhook paths ended
   * up swallowing failures invisibly.
   */
  failureMode: text('failure_mode', { enum: INTEGRATION_FAILURE_MODES }).notNull().default('best_effort'),
  /**
   * Last time a probe reached this system. Only ever set on SUCCESS: "when did
   * this last work" is the question an operator has, and overwriting it on a
   * failed attempt would answer a different one. NULL = never contacted.
   */
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  /**
   * Why the most recent probe failed, cleared on the next success. Kept
   * alongside `last_contacted_at` rather than replacing it so the pair reads as
   * "worked at T, broken since" — an integration that is silently unreachable is
   * worse than none.
   */
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // At most one integration of a kind per environment, and at most one
  // portal-wide one per kind. Two partial indexes rather than one
  // UNIQUE (kind, environment_id): Postgres treats NULLs as distinct, so the
  // plain constraint would happily accept five portal-wide Foremans and leave
  // "which Foreman does this environment reconcile against" (#112) unanswerable.
  //
  // The cost is real and deliberate: this forbids two Nexus instances in one
  // environment. That is the trade for `resolveIntegration(kind, envId)` having
  // exactly one answer instead of an arbitrary first row.
  uniqueIndex('integrations_kind_env_key')
    .on(t.kind, t.environmentId)
    .where(sql`environment_id IS NOT NULL`),
  uniqueIndex('integrations_kind_global_key')
    .on(t.kind)
    .where(sql`environment_id IS NULL`),
  // Every read is a resolve: "the <kind> for this environment, else the global
  // one, if enabled".
  index('integrations_kind_enabled_idx').on(t.kind, t.enabled),
])

export const deploymentEnvironments = pgTable('deployment_environments', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  ciSourceId: bigint('ci_source_id', { mode: 'number' }).notNull().references(() => ciSources.id),
  webhookUrl: text('webhook_url').notNull(),
  webhookToken: text('webhook_token').notNull(),
  // Portal-generated secret sent by GitLab as X-Gitlab-Token on the pipeline
  // event callback. Kept separate from webhook_token (the outbound trigger
  // token) so operators can rotate the two independently.
  //
  // UNIQUE: the secret is what identifies the calling environment on an inbound
  // callback (see the webhook routes). If two environments shared it the route
  // could only pick one arbitrarily and would mis-scope valid events — the
  // legacy 0004 backfill from webhook_token made that possible, so migration
  // 0006 rotates duplicates and enforces uniqueness.
  callbackSecret: text('callback_secret').notNull().unique(),
})

export const productEnvironments = pgTable('product_environments', {
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id),
  price: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
  currency: text().notNull().default('EUR'),
  costCenterMode: text('cost_center_mode', { enum: ['project', 'select', 'overhead'] }).notNull().default('project'),
  forcedCostCenter: boolean('forced_cost_center').notNull().default(false),
  // The fixed shared cost centre used by `overhead` mode (FA-10.4). Without it
  // `overhead` had no cost centre to point at and fell through to the same
  // behaviour as `select` — the user picked, which is the opposite of a fixed
  // overhead account. Nullable because the other two modes never use it, and
  // because an offering may be switched to `overhead` before one is chosen.
  overheadCostCenterId: bigint('overhead_cost_center_id', { mode: 'number' }).references(() => costCenters.id, { onDelete: 'set null' }),
  // Time-boxed trial of this offering (issue #1). Opt-in per offering rather than
  // catalogue-wide: a trial provisions real infrastructure with elevated rights
  // inside it, which is not something every product should hand out.
  trialEnabled: boolean('trial_enabled').notNull().default(false),
  // Configurable so a heavier app can get longer than the 30 minutes the issue
  // names; 30 is the default, not a constant.
  trialDurationMinutes: integer('trial_duration_minutes').notNull().default(30),
}, (t) => [primaryKey({ columns: [t.productId, t.environmentId] })])

export const productWebhooks = pgTable('product_webhooks', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id),
  name: text().notNull(),
  webhookUrl: text('webhook_url').notNull(),
  webhookToken: text('webhook_token').notNull(),
  execOrder: integer('exec_order').notNull().default(0),
})

export const pipelineStacks = pgTable('pipeline_stacks', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  stateKeyParam: text('state_key_param').notNull().default('hostname'),
  steps: jsonb().$type<StackStep[]>().notNull().default([]),
})

// Per-user product bookmarks. Composite primary key rather than a surrogate id:
// a user can favourite a product once, and the uniqueness that expresses is the
// same thing the lookup needs — no separate index, no way to store a duplicate.
export const productFavorites = pgTable('product_favorites', {
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.productId] })])

// Timeline of catalogue changes to a product (issue #38). One row per change that
// affects what a customer would be offered, so the history explains what an
// existing order's snapshot differs FROM.
export const productVersions = pgTable('product_versions', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  // Which offering the snapshot describes. Null for a change to the product itself
  // (name, description, category) which is not specific to one environment.
  environmentId: bigint('environment_id', { mode: 'number' }).references(() => deploymentEnvironments.id, { onDelete: 'set null' }),
  // Optional free text from whoever made the change. The issue calls it optional;
  // an empty string is the "no note" case rather than a null, so readers do not
  // have to handle both.
  changelog: text().notNull().default(''),
  /** What changed, so the row is meaningful without diffing. */
  summary: text().notNull().default(''),
  snapshot: jsonb().$type<ProductSnapshot>(),
  // No ON DELETE on the author: a version entry that loses its attribution stops
  // being a history.
  createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const costCenters = pgTable('cost_centers', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
})

export const projects = pgTable('projects', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  ownerId: bigint('owner_id', { mode: 'number' }).notNull().references(() => users.id),
  costCenterId: bigint('cost_center_id', { mode: 'number' }).references(() => costCenters.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orders = pgTable('orders', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
  status: text({ enum: ['pending', 'provisioning', 'completed', 'failed', 'rejected'] }).notNull().default('pending'),
  parameters: jsonb().$type<Record<string, string>>().notNull().default({}),
  costCenterId: bigint('cost_center_id', { mode: 'number' }).references(() => costCenters.id),
  // Ordered as a time-boxed trial (issue #1). Recorded on the ORDER rather than
  // only acted on at creation time: a project manager's order is provisioned at
  // approval, which is where the trial clock has to start and where the trial
  // variables have to be passed to CI.
  isTrial: boolean('is_trial').notNull().default(false),
  // What the customer was actually offered when the order was placed (issue #38).
  // Orders reference the product by id, so without this a later price change or a
  // removed parameter silently rewrites history and the order detail page shows
  // today's configuration as the one that was approved. Nullable: orders placed
  // before this existed have no snapshot, and inventing one would be a lie.
  productSnapshot: jsonb('product_snapshot').$type<ProductSnapshot>(),
  rejectionNote: text('rejection_note'),
  pipelineId: jsonb('pipeline_id').$type<string[]>().notNull().default([]),
  // Per-pipeline terminal status keyed by pipeline id, e.g.
  // { "pipe-a": "success", "pipe-b": "failed" }. Lets a multi-pipeline order
  // wait for ALL its pipelines to succeed before completing (and fail fast if
  // any one fails/cancels) instead of completing on the first success event.
  pipelineStatus: jsonb('pipeline_status').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Items a user has collected but not yet ordered (issue #28).
//
// Not an order in a 'draft' state: a cart item has no project, no validated
// parameters and no cost centre, so putting it in `orders` would mean every query
// over orders had to exclude drafts, and a draft would appear in approval queues
// and audit exports the moment someone forgot a WHERE clause.
export const cartItems = pgTable('cart_items', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id, { onDelete: 'cascade' }),
  // Whatever the user had typed when they added the item. Deliberately NOT
  // validated on the way in — a cart is a shopping list, and refusing to hold an
  // incomplete item would defeat the point of collecting first and filling in at
  // checkout. Validation happens at checkout, against the same rules a single
  // order goes through.
  parameters: jsonb().$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Free-text discussion on an order (issue #34). The rejection note already proved
// a note can be stored per order; this generalises it into a thread.
export const orderComments = pgTable('order_comments', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  orderId: bigint('order_id', { mode: 'number' }).notNull().references(() => orders.id, { onDelete: 'cascade' }),
  // No ON DELETE: a comment must not lose its author. Deactivating a user is how
  // they are retired, and the audit trail depends on attribution surviving.
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
  body: text().notNull(),
  // Visible to admin/root only. The orderer must never see one, so every read
  // path filters on this rather than relying on the UI to hide it.
  internal: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Distinct from createdAt so an edited comment can be shown as edited rather
  // than silently rewritten under a reader who already replied to it.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const infrastructureElements = pgTable('infrastructure_elements', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  orderId: bigint('order_id', { mode: 'number' }).notNull().references(() => orders.id),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id),
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  status: text({ enum: ['active', 'decommissioning', 'decommissioned'] }).notNull().default('active'),
  parameters: jsonb().$type<Record<string, string>>().notNull().default({}),
  pipelineId: jsonb('pipeline_id').$type<string[]>().notNull().default([]),
  // Per-pipeline terminal status for the current decommission run, keyed by
  // pipeline id (mirrors orders.pipeline_status). A teardown may fan out to
  // several pipelines (product webhooks + pipeline stacks); the element only
  // becomes 'decommissioned' once EVERY id in pipeline_id succeeded.
  pipelineStatus: jsonb('pipeline_status').$type<Record<string, string>>().notNull().default({}),
  outputs: jsonb().$type<Record<string, string>>().notNull().default({}),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).defaultNow(),
  // When set, the element is torn down automatically at or after this instant
  // (issue #30). Temporary environments — test, demo, PoC — are otherwise
  // forgotten and keep accruing cost. NULL means "no schedule", which is the
  // only way to express "never": a sentinel far-future date would eventually
  // arrive.
  scheduledDecommissionAt: timestamp('scheduled_decommission_at', { withTimezone: true }),
})

export const exchangeRates = pgTable('exchange_rates', {
  currencyCode: text('currency_code').primaryKey(),
  rate: numeric({ precision: 18, scale: 6 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.id),
  action: text().notNull(),
  entityId: bigint('entity_id', { mode: 'number' }),
  details: text().notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * An admin's approval authority, held by a substitute for a period (issue #35).
 *
 * What is delegated is AUTHORITY, not identity: the substitute approves as
 * themselves and every decision they take while a delegation is in force is
 * audited with the delegation that was in force. Nothing here lets one user act
 * under another's name.
 *
 * Expiry is a date comparison at read time (`starts_on <= today <= ends_on`,
 * both inclusive) — there is deliberately no job to run and no `active` column
 * to fall out of sync with the calendar.
 */
export const approvalDelegations = pgTable('approval_delegations', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  fromUserId: bigint('from_user_id', { mode: 'number' }).notNull().references(() => users.id),
  toUserId: bigint('to_user_id', { mode: 'number' }).notNull().references(() => users.id),
  // `date` in mode 'string' so a period stays the calendar days the admin typed
  // instead of being shifted by the server's timezone on the way in and out.
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Cancelled early. Kept rather than deleted so the audit entries that name this
  // delegation keep resolving.
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const branding = pgTable('branding', {
  id: integer().primaryKey().default(1),
  logoData: bytea('logo_data'),
  logoMime: text('logo_mime'),
  primaryColor: text('primary_color').notNull().default('#131921'),
  secondaryColor: text('secondary_color').notNull().default('#febd69'),
  shopName: text('shop_name').notNull().default('Open Hybrid Cloud'),
  shopSubtitle: text('shop_subtitle').notNull().default(''),
  imprintText: text('imprint_text').notNull().default(''),
})

export const appConfig = pgTable('app_config', {
  id: integer().primaryKey().default(1),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpFrom: text('smtp_from'),
  smtpUser: text('smtp_user'),
  smtpPass: text('smtp_pass'),
  smtpTls: boolean('smtp_tls').default(true),
  aiProvider: text('ai_provider'),
  aiEndpoint: text('ai_endpoint'),
  aiApiKey: text('ai_api_key'),
  aiModel: text('ai_model'),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductTranslation = typeof productTranslations.$inferSelect
export type Parameter = typeof parameters.$inferSelect
export type CiSource = typeof ciSources.$inferSelect
export type Integration = typeof integrations.$inferSelect
export type NewIntegration = typeof integrations.$inferInsert
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]
export type IntegrationAuthType = (typeof INTEGRATION_AUTH_TYPES)[number]
export type IntegrationFailureMode = (typeof INTEGRATION_FAILURE_MODES)[number]
export type DeploymentEnvironment = typeof deploymentEnvironments.$inferSelect
export type ProductEnvironment = typeof productEnvironments.$inferSelect
export type ProductWebhook = typeof productWebhooks.$inferSelect
export type PipelineStack = typeof pipelineStacks.$inferSelect
export type ProductFavorite = typeof productFavorites.$inferSelect
export type ProductVersion = typeof productVersions.$inferSelect
export type CostCenter = typeof costCenters.$inferSelect
export type Project = typeof projects.$inferSelect
export type Order = typeof orders.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type OrderComment = typeof orderComments.$inferSelect
export type InfrastructureElement = typeof infrastructureElements.$inferSelect
export type ExchangeRate = typeof exchangeRates.$inferSelect
export type AuditEntry = typeof auditLog.$inferSelect
export type ApprovalDelegation = typeof approvalDelegations.$inferSelect
export type Branding = typeof branding.$inferSelect
export type AppConfig = typeof appConfig.$inferSelect
