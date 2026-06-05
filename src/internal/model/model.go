package model

import "time"

// --- Roles ---

type Role string

const (
	RoleAdmin         Role = "admin"
	RoleProjectLeader Role = "project_leader"
	RoleRoot          Role = "root"
)

// --- Users ---

type User struct {
	ID           int64
	Email        string
	Name         string
	Role         Role
	Active       bool
	SSOSub       string // Entra ID subject claim; empty for local accounts
	PasswordHash string // only set for local accounts (shop admin)
	CreatedAt    time.Time
}

// --- Product catalogue ---

type Category struct {
	ID           int64
	Name         string
	DisplayOrder int
}

type Product struct {
	ID           int64
	CategoryID   int64
	BaseLanguage string
	Image        []byte
	CreatedAt    time.Time
	// Computed from product_translations at service level — not persisted
	Name        string
	Description string
}

type ProductTranslation struct {
	ProductID    int64
	LanguageCode string
	Name         string
	Description  string
}

type Parameter struct {
	ID            int64
	Scope         ParameterScope // global, category, product
	ScopeID       int64          // CategoryID or ProductID, 0 for global
	EnvironmentID int64          // 0 = applies to all environments
	Name          string
	Type          ParameterType
	Description   string
	DefaultValue  string
	Required      bool
	Sensitive     bool
}

type ParameterScope string

const (
	ParameterScopeGlobal   ParameterScope = "global"
	ParameterScopeCategory ParameterScope = "category"
	ParameterScopeProduct  ParameterScope = "product"
)

type ParameterType string

const (
	ParameterTypeString   ParameterType = "string"
	ParameterTypeNumber   ParameterType = "number"
	ParameterTypeBool     ParameterType = "bool"
	ParameterTypeDropdown ParameterType = "dropdown"
)

// --- GitLab & deployment ---

type GitLabSource struct {
	ID          int64
	Name        string
	URL         string
	AccessToken string
}

type DeploymentEnvironment struct {
	ID             int64
	Name           string
	Description    string
	GitLabSourceID int64
	WebhookURL     string
	WebhookToken   string
}

type ProductEnvironment struct {
	ProductID        int64
	EnvironmentID    int64
	Price            float64
	Currency         string // billing currency
	CostCenterMode   CostCenterMode
	ForcedCostCenter bool
}

// ProductWebhook defines one pipeline trigger endpoint for a product+environment combination.
// Multiple webhooks are fired in ascending ExecOrder (ties are fired concurrently).
// If none are defined the DeploymentEnvironment.WebhookURL/Token is used as fallback.
type ProductWebhook struct {
	ID            int64
	ProductID     int64
	EnvironmentID int64
	Name          string
	WebhookURL    string
	WebhookToken  string
	ExecOrder     int
}

// --- Cost centres ---

type CostCenter struct {
	ID     int64
	Code   string
	Name   string
	Active bool
}

type CostCenterMode string

const (
	CostCenterModeProject  CostCenterMode = "project"
	CostCenterModeSelect   CostCenterMode = "select"
	CostCenterModeOverhead CostCenterMode = "overhead"
)

// --- Projects ---

type Project struct {
	ID           int64
	Name         string
	Description  string
	OwnerID      int64
	CostCenterID int64
	CreatedAt    time.Time
}

// --- Orders ---

type OrderStatus string

const (
	OrderStatusPendingApproval OrderStatus = "pending_approval"
	OrderStatusApproved        OrderStatus = "approved"
	OrderStatusRejected        OrderStatus = "rejected"
	OrderStatusProvisioning    OrderStatus = "provisioning"
	OrderStatusCompleted       OrderStatus = "completed"
	OrderStatusFailed          OrderStatus = "failed"
	OrderStatusDecommissioning OrderStatus = "decommissioning"
	OrderStatusDecommissioned  OrderStatus = "decommissioned"
)

type Order struct {
	ID            int64
	ProjectID     int64
	ProductID     int64
	EnvironmentID int64
	UserID        int64
	Status        OrderStatus
	Parameters    map[string]string
	CostCenterID  int64
	RejectionNote string
	PipelineIDs   []string // GitLab pipeline IDs (one per webhook) for polling
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// --- Infrastructure ---

type InfrastructureElement struct {
	ID            int64
	OrderID       int64
	ProjectID     int64
	EnvironmentID int64
	ProductID     int64
	Status        OrderStatus
	Parameters    map[string]string
	PipelineIDs   []string          // GitLab pipeline IDs for polling
	Outputs       map[string]string // OpenTofu outputs after successful apply
	DeployedAt    time.Time
}

// --- Branding ---

type Branding struct {
	LogoData       []byte
	LogoMime       string
	PrimaryColor   string
	SecondaryColor string
	ShopName       string
	ShopSubtitle   string
	ImprintText    string
}

// --- App Config ---

type AppConfig struct {
	SMTPHost     string
	SMTPPort     string
	SMTPFrom     string
	SMTPUsername string
	SMTPPassword string
	SMTPTLS      bool
	AIProvider   string
	AIEndpoint   string
	AIAPIKey     string
	AIModel      string
}

// --- Audit ---

type AuditAction string

const (
	AuditActionOrderCreated   AuditAction = "order.created"
	AuditActionOrderApproved  AuditAction = "order.approved"
	AuditActionOrderRejected  AuditAction = "order.rejected"
	AuditActionOrderDeployed  AuditAction = "order.deployed"
	AuditActionOrderFailed    AuditAction = "order.failed"
	AuditActionDecommissioned AuditAction = "infra.decommissioned"
	AuditActionConfigChanged  AuditAction = "config.changed"
)

type AuditEntry struct {
	ID        int64
	UserID    int64
	Action    AuditAction
	EntityID  int64
	Details   string
	CreatedAt time.Time
}
