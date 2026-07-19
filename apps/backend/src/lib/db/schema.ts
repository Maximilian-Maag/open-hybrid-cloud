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
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core'
import type { StackStep } from '@open-hybrid-cloud/types'

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

export const categories = pgTable('categories', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  displayOrder: integer('display_order').notNull().default(0),
})

export const products = pgTable('products', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  categoryId: bigint('category_id', { mode: 'number' }).notNull().references(() => categories.id, { onDelete: 'cascade' }),
  baseLanguage: text('base_language').notNull().default('de'),
  image: bytea('image'),
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

export const deploymentEnvironments = pgTable('deployment_environments', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  ciSourceId: bigint('ci_source_id', { mode: 'number' }).notNull().references(() => ciSources.id),
  webhookUrl: text('webhook_url').notNull(),
  webhookToken: text('webhook_token').notNull(),
})

export const productEnvironments = pgTable('product_environments', {
  productId: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  environmentId: bigint('environment_id', { mode: 'number' }).notNull().references(() => deploymentEnvironments.id),
  price: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
  currency: text().notNull().default('EUR'),
  costCenterMode: text('cost_center_mode', { enum: ['project', 'select', 'overhead'] }).notNull().default('project'),
  forcedCostCenter: boolean('forced_cost_center').notNull().default(false),
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
  webhookUrl: text('webhook_url').notNull(),
  webhookToken: text('webhook_token').notNull(),
  stateKeyParam: text('state_key_param').notNull().default('hostname'),
  steps: jsonb().$type<StackStep[]>().notNull().default([]),
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
  rejectionNote: text('rejection_note'),
  pipelineId: jsonb('pipeline_id').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  outputs: jsonb().$type<Record<string, string>>().notNull().default({}),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).defaultNow(),
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
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductTranslation = typeof productTranslations.$inferSelect
export type Parameter = typeof parameters.$inferSelect
export type CiSource = typeof ciSources.$inferSelect
export type DeploymentEnvironment = typeof deploymentEnvironments.$inferSelect
export type ProductEnvironment = typeof productEnvironments.$inferSelect
export type ProductWebhook = typeof productWebhooks.$inferSelect
export type PipelineStack = typeof pipelineStacks.$inferSelect
export type CostCenter = typeof costCenters.$inferSelect
export type Project = typeof projects.$inferSelect
export type Order = typeof orders.$inferSelect
export type InfrastructureElement = typeof infrastructureElements.$inferSelect
export type ExchangeRate = typeof exchangeRates.$inferSelect
export type AuditEntry = typeof auditLog.$inferSelect
export type Branding = typeof branding.$inferSelect
export type AppConfig = typeof appConfig.$inferSelect
