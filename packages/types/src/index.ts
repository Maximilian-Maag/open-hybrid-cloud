// Roles and enums
export type Role = 'admin' | 'project_manager' | 'root'
export type OrderStatus = 'pending' | 'provisioning' | 'completed' | 'failed' | 'rejected'
export type InfraStatus = 'active' | 'decommissioning' | 'decommissioned'
export type CostCenterMode = 'project' | 'select' | 'overhead'
export type ParameterScope = 'global' | 'category' | 'product'
export type ParameterType = 'string' | 'number' | 'bool' | 'dropdown'
export type CiProvider = 'gitlab' | 'github' | 'bitbucket'
export type AiProviderType = 'claude' | 'openai' | 'azure_openai' | 'ollama' | 'localai'

// Auth
export interface SessionUser {
  id: number
  email: string
  name: string
  role: Role
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: SessionUser
}

// Users
export interface User {
  id: number
  email: string
  name: string
  role: Role
  active: boolean
  ssoSub: string | null
  createdAt: string
}

export interface CreateUserRequest {
  email: string
  name: string
  role: Role
  password: string
}

export interface UpdateUserRequest {
  name?: string
  role?: Role
  active?: boolean
}

export interface UpdateProfileRequest {
  name: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

// Categories
export interface Category {
  id: number
  name: string
  displayOrder: number
}

export interface CreateCategoryRequest {
  name: string
  displayOrder?: number
}

export interface UpdateCategoryRequest {
  name?: string
  displayOrder?: number
}

// Products
export interface Product {
  id: number
  categoryId: number
  baseLanguage: string
  createdAt: string
  name: string
  description: string
  /**
   * What the product picture shows, for its `alt` attribute.
   *
   * Null when the product has no image. Required whenever one is uploaded, so a
   * component never has to invent a description or decide the picture is
   * decorative — which is what every one of them used to do differently.
   */
  imageAlt?: string | null
}

export interface ProductDetail extends Product {
  environments: ProductEnvironment[]
  parameters: Parameter[]
}

export interface CreateProductRequest {
  categoryId: number
  baseLanguage: string
  name: string
  description: string
}

export interface UpdateProductRequest {
  categoryId?: number
  baseLanguage?: string
  name?: string
  description?: string
  /** Optional free text describing the change, recorded in the history (issue #38). */
  changelog?: string
}

export interface ProductTranslation {
  productId: number
  languageCode: string
  name: string
  description: string
}

// Parameters
export interface Parameter {
  id: number
  scope: ParameterScope
  scopeId: number
  environmentId: number | null
  name: string
  label: string
  type: ParameterType
  description: string
  defaultValue: string
  required: boolean
  sensitive: boolean
}

export interface CreateParameterRequest {
  scope: ParameterScope
  scopeId: number
  environmentId?: number
  name: string
  label?: string
  type: ParameterType
  description?: string
  defaultValue?: string
  required?: boolean
  sensitive?: boolean
}

export interface UpdateParameterRequest {
  name?: string
  label?: string
  type?: ParameterType
  description?: string
  defaultValue?: string
  required?: boolean
  sensitive?: boolean
}

// CI Sources
export interface CiSource {
  id: number
  name: string
  url: string
  provider: CiProvider
}

export interface CreateCiSourceRequest {
  name: string
  url: string
  accessToken: string
  provider: CiProvider
}

export interface UpdateCiSourceRequest {
  name?: string
  url?: string
  accessToken?: string
  provider?: CiProvider
}

// Deployment Environments
export interface DeploymentEnvironment {
  id: number
  name: string
  description: string
  ciSourceId: number
}

// Response shape for GET/POST /api/admin/environments/:id/callback-secret.
// The portal-owned inbound webhook secret is returned in the clear here so
// the operator can copy it into GitLab (Settings → Webhooks → Secret token).
export interface CallbackSecretResponse {
  callbackSecret: string
}

export interface CreateEnvironmentRequest {
  name: string
  description?: string
  ciSourceId: number
  webhookUrl: string
  webhookToken: string
}

export interface UpdateEnvironmentRequest {
  name?: string
  description?: string
  ciSourceId?: number
  webhookUrl?: string
  webhookToken?: string
}

// Product Environments
export interface ProductEnvironment {
  productId: number
  environmentId: number
  price: string
  currency: string
  costCenterMode: CostCenterMode
  forcedCostCenter: boolean
  /**
   * The fixed shared cost centre used by `overhead` mode (FA-10.4). null for
   * the other two modes, and for an `overhead` offering that has not had an
   * account chosen yet.
   */
  overheadCostCenterId: number | null
  /**
   * Whether this offering can be ordered as a time-boxed trial (issue #1).
   * Opt-in per offering: a trial provisions real infrastructure and asks the
   * pipeline to grant elevated rights inside it.
   */
  trialEnabled: boolean
  /** How long a trial of this offering lives. Defaults to 30 minutes. */
  trialDurationMinutes: number
  environmentName?: string
  /** Resolved name of `overheadCostCenterId`, for display in the order form. */
  overheadCostCenterName?: string | null
}

export interface UpsertProductEnvironmentRequest {
  price: string
  currency: string
  costCenterMode: CostCenterMode
  forcedCostCenter: boolean
  overheadCostCenterId?: number | null
  trialEnabled?: boolean
  trialDurationMinutes?: number
  /** Optional free text describing the change, recorded in the history (issue #38). */
  changelog?: string
}

// Product Webhooks
export interface ProductWebhook {
  id: number
  productId: number
  environmentId: number
  name: string
  webhookUrl: string
  execOrder: number
}

export interface CreateProductWebhookRequest {
  environmentId: number
  name: string
  webhookUrl: string
  webhookToken: string
  execOrder?: number
}

// Pipeline Stacks
export interface UpstreamRef {
  // CI variable name exposed to the child template (uppercase convention).
  // The base pipeline promotes this to TF_VAR_<lowercase> for Terraform.
  varName: string
  // stateSuffix of an earlier step whose state this ref points to.
  suffix: string
}

export interface StackStep {
  template: string
  stateSuffix: string
  // execOrder groups: steps with the same value run in parallel; groups run
  // sequentially from lowest to highest. Defaults to 0.
  execOrder?: number
  // Zero or more upstream state references (replaces the single upstreamSuffix).
  upstreamRefs?: UpstreamRef[]
  fixedParams?: Record<string, string>
}

export interface PipelineStack {
  id: number
  productId: number
  environmentId: number
  name: string
  stateKeyParam: string
  steps: StackStep[]
}

// Stacks inherit the deployment environment's webhook_url + webhook_token —
// having them on the stack itself let the two tokens diverge and broke the
// outbound trigger while the inbound callback still validated the env token.
export interface CreatePipelineStackRequest {
  environmentId: number
  name: string
  stateKeyParam?: string
  steps: StackStep[]
}

export interface UpdatePipelineStackRequest {
  name?: string
  stateKeyParam?: string
  steps?: StackStep[]
}

// Cost Centers
export interface CostCenter {
  id: number
  code: string
  name: string
  active: boolean
}

export interface CreateCostCenterRequest {
  code: string
  name: string
  active?: boolean
}

export interface UpdateCostCenterRequest {
  code?: string
  name?: string
  active?: boolean
}

// Projects
export interface Project {
  id: number
  name: string
  description: string
  ownerId: number
  costCenterId: number | null
  createdAt: string
  ownerName?: string
  costCenterName?: string
}

export interface CreateProjectRequest {
  name: string
  description?: string
  costCenterId?: number
}

export interface UpdateProjectRequest {
  name?: string
  description?: string
  costCenterId?: number
}

// Orders
export interface Order {
  id: number
  projectId: number
  productId: number
  environmentId: number
  userId: number
  status: OrderStatus
  parameters: Record<string, string>
  costCenterId: number | null
  rejectionNote: string | null
  pipelineId: string[]
  createdAt: string
  updatedAt: string
  /** Ordered as a time-boxed trial (issue #1). */
  isTrial?: boolean
  /**
   * What the customer was offered when the order was placed (issue #38). Null for
   * orders placed before snapshots existed — the order detail page falls back to
   * the live product for those, and says so.
   */
  productSnapshot?: ProductSnapshot | null
  productName?: string
  environmentName?: string
  projectName?: string
  userName?: string
}

export interface CreateOrderRequest {
  projectId: number
  productId: number
  environmentId: number
  costCenterId?: number
  parameters: Record<string, string>
  /**
   * Order as a time-boxed trial (issue #1). Only accepted for an offering with
   * `trialEnabled`; it does NOT bypass approval — a project manager's trial still
   * needs an admin to approve it.
   */
  trial?: boolean
}

// ─── Costs (issue #32) ────────────────────────────────────────────────────────

export type CostRange = 'currentMonth' | 'last3Months' | 'last12Months' | 'all' | 'custom'

export interface CostBucket {
  id: number | null
  label: string
  /** EUR, the exchange-rate base. Convert client-side for display. */
  totalEur: number
  orderCount: number
}

export interface CostReport {
  totalEur: number
  orderCount: number
  /**
   * Orders whose price came from the live offering because they predate snapshots.
   * Non-zero means the total is partly inferred rather than exact.
   */
  estimatedOrders: number
  byProject: CostBucket[]
  byCostCenter: CostBucket[]
  byProduct: CostBucket[]
  byEnvironment: CostBucket[]
  /** Amounts with no stored exchange rate, reported rather than silently dropped. */
  unconverted: { currency: string; amount: number }[]
  /** True when the caller sees every project's spend. */
  global: boolean
}

// ─── Cart (issue #28) ─────────────────────────────────────────────────────────

export interface CartItem {
  id: number
  productId: number
  environmentId: number
  /** Prefill only — validated at checkout, not when added. */
  parameters: Record<string, string>
  createdAt: string
  productName: string | null
  environmentName: string | null
  price: string | null
  currency: string | null
  /** Description of the product picture, for its `alt` attribute. */
  imageAlt?: string | null
  /** False when the product is no longer offered in that environment. */
  stillOffered: boolean
}

export interface AddToCartRequest {
  productId: number
  environmentId: number
  parameters?: Record<string, string>
}

export interface CheckoutItem {
  cartItemId: number
  parameters: Record<string, string>
  costCenterId?: number
  trial?: boolean
}

export interface CheckoutRequest {
  projectId: number
  items: CheckoutItem[]
}

export interface CheckoutResponse {
  orderIds: number[]
  /**
   * Items whose orders could not be created after validation passed. These stay in
   * the cart — a fired pipeline cannot be recalled, so partial failure is reported
   * rather than hidden.
   */
  failed: { cartItemId: number; message: string }[]
}

// ─── Product versioning (issue #38) ───────────────────────────────────────────

/** One parameter definition as it stood when a snapshot was taken. */
export interface ParameterSnapshot {
  name: string
  label: string
  type: string
  description: string
  /** '[redacted]' when the parameter is flagged sensitive. */
  defaultValue: string
  required: boolean
  sensitive: boolean
}

/**
 * Point-in-time capture of what a customer was offered.
 *
 * Stored on the order so a later price change or removed parameter cannot rewrite
 * what the order detail page reports as approved.
 */
export interface ProductSnapshot {
  version: 1
  capturedAt: string
  productName: string
  productDescription: string
  environmentName: string
  price: string
  currency: string
  costCenterMode: CostCenterMode
  forcedCostCenter: boolean
  /**
   * The overhead account the offering bills to, as a label (issue #22).
   *
   * Optional: snapshots taken before it was captured do not carry it, so absent
   * means "unknown" rather than "none" — a diff must not report every older
   * version as a change.
   */
  overheadCostCenter?: string | null
  trialEnabled: boolean
  trialDurationMinutes: number
  parameters: ParameterSnapshot[]
}

/** One entry in a product's change history. */
export interface ProductVersion {
  id: number
  productId: number
  /** Null for a change to the product itself rather than to one offering. */
  environmentId: number | null
  changelog: string
  summary: string
  snapshot: ProductSnapshot | null
  createdBy: number | null
  createdAt: string
  authorName: string | null
  environmentName: string | null
}

export interface SnapshotFieldChange {
  field: string
  from: string
  to: string
}

export type SnapshotParameterChange =
  | { kind: 'added'; name: string; to: ParameterSnapshot }
  | { kind: 'removed'; name: string; from: ParameterSnapshot }
  | { kind: 'changed'; name: string; fields: SnapshotFieldChange[] }

export interface ProductVersionDiff {
  fields: SnapshotFieldChange[]
  parameters: SnapshotParameterChange[]
  identical: boolean
  fromVersionId: number
  toVersionId: number
}

/**
 * A comment on an order (issue #34).
 *
 * An `internal` comment is only ever returned to admin/root — the API filters
 * them out for other callers rather than relying on the client to hide them.
 */
export interface OrderComment {
  id: number
  orderId: number
  userId: number
  body: string
  internal: boolean
  createdAt: string
  updatedAt: string
  userName: string | null
  /** True when the comment was edited after posting. */
  edited: boolean
}

export interface CreateOrderCommentRequest {
  body: string
  /** Admin/root only; rejected with 403 otherwise. */
  internal?: boolean
}

export interface UpdateOrderCommentRequest {
  body: string
}

export interface RejectOrderRequest {
  rejectionNote: string
}

// Infrastructure
export interface InfrastructureElement {
  id: number
  orderId: number
  projectId: number
  environmentId: number
  productId: number
  status: InfraStatus
  parameters: Record<string, string>
  pipelineId: string[]
  outputs: Record<string, string>
  deployedAt: string | null
  /**
   * When set, the element is torn down automatically at or after this instant
   * (issue #30). null = no schedule.
   */
  scheduledDecommissionAt?: string | null
  productName?: string
  environmentName?: string
  projectName?: string
  /**
   * Status of the order this element came from. The element's own status cannot
   * express a failed deployment — it is created `active` when provisioning starts
   * and stays there if the pipeline fails — so a failed deployment is
   * `status: 'active'` with `orderStatus: 'failed'`.
   */
  orderStatus?: OrderStatus | null
}

/**
 * One infrastructure element in full (GET /infrastructure/{id}).
 *
 * Everything the list carries, plus what only a detail view needs: the pipeline
 * status map, the cost centre the order is billed to, and which parameter values
 * were redacted — the names stay visible, the values do not.
 */
export interface InfrastructureDetail extends InfrastructureElement {
  pipelineStatus: Record<string, string>
  costCenter: string | null
  orderCreatedAt: string | null
  isTrial: boolean
  redactedParameters: string[]
}

/** Option lists for the infrastructure list filters (GET /infrastructure/facets). */
export interface InfraFacets {
  environments: { id: number; name: string }[]
  projects: { id: number; name: string }[]
  products: { id: number; name: string }[]
}

export type InfraSortField = 'date' | 'name' | 'status'

/** A product the current user has favourited (GET /favorites). */
export interface FavoriteProduct {
  productId: number
  categoryId: number
  name: string
  description: string
  createdAt: string
}

// Exchange Rates
export interface ExchangeRate {
  currencyCode: string
  rate: string
  updatedAt: string
}

// Audit
export interface AuditEntry {
  id: number
  userId: number | null
  action: string
  entityId: number | null
  details: string
  createdAt: string
  userName?: string
}

export interface AuditFilter {
  userId?: number
  action?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

// Branding
export interface Branding {
  primaryColor: string
  secondaryColor: string
  shopName: string
  shopSubtitle: string
  imprintText: string
  logoMime?: string
}

export interface UpdateBrandingRequest {
  primaryColor?: string
  secondaryColor?: string
  shopName?: string
  shopSubtitle?: string
  imprintText?: string
}

// App Config
export interface SmtpConfig {
  host: string
  port: number
  from: string
  user: string
  tls: boolean
}

export interface UpdateSmtpRequest {
  host: string
  port: number
  from: string
  user: string
  password?: string
  tls: boolean
}

export interface AiConfig {
  provider: AiProviderType
  endpoint: string
  model: string
}

export interface UpdateAiConfigRequest {
  provider: AiProviderType
  endpoint: string
  apiKey?: string
  model: string
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

// API error
export interface ApiError {
  error: string
  details?: unknown
}

// Pipeline webhook events (normalized across providers)
export interface PipelineEvent {
  provider: CiProvider
  pipelineId: string
  status: 'success' | 'failed' | 'running' | 'pending' | 'canceled'
}

// CI repository browser
export interface CiProject {
  id: string
  name: string
  fullPath: string
}

export interface CiBranch {
  name: string
}

export interface CiFile {
  name: string
  path: string
  type: 'blob' | 'tree'
}
