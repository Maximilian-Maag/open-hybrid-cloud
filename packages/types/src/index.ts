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
  type: ParameterType
  description?: string
  defaultValue?: string
  required?: boolean
  sensitive?: boolean
}

export interface UpdateParameterRequest {
  name?: string
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
  environmentName?: string
}

export interface UpsertProductEnvironmentRequest {
  price: string
  currency: string
  costCenterMode: CostCenterMode
  forcedCostCenter: boolean
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
  productName?: string
  environmentName?: string
  projectName?: string
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
