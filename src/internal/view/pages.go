package view

import "github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"

// --- Home ---

type HomeStats struct {
	PendingOrders int
	TotalOrders   int
	Projects      int
	InfraCount    int
}

type ProductCardView struct {
	model.Product
	CategoryName string
	MinPrice     float64
	Currency     string
	EnvCount     int
}

type HomeView struct {
	PageData
	Stats    HomeStats
	Featured []ProductCardView
}

// --- Catalog ---

type CatalogEnvEntry struct {
	ID       int64
	Name     string
	Price    float64
	Currency string
}

type CatalogView struct {
	PageData
	Categories  []model.Category
	Products    []ProductCardView
	Query       string
	SelectedCat int64
}

type CatalogProductView struct {
	PageData
	Product      *model.Product
	Environments []CatalogEnvEntry
	Parameters   []model.Parameter
	CategoryName string
}

// --- Login ---

type LoginView struct {
	PageData
	Error       string
	OIDCEnabled bool
}

// --- Orders ---

type OrderListView struct {
	PageData
	Orders []model.Order
}

type OrderDetailView struct {
	PageData
	Order   *model.Order
	Product *model.Product
	Env     *model.DeploymentEnvironment
	Project *model.Project
	Infra   *model.InfrastructureElement
}

type OrderNewView struct {
	PageData
	Product         *model.Product
	Environment     *model.DeploymentEnvironment
	Projects        []model.Project
	Parameters      []model.Parameter
	CostCenters     []model.CostCenter
	PrefilledParams map[string]string
}

// --- Projects ---

type ProjectListView struct {
	PageData
	Projects    []model.Project
	CostCenters []model.CostCenter
}

type ProjectNewView struct {
	PageData
	CostCenters []model.CostCenter
}

type ProjectDetailView struct {
	PageData
	Project     *model.Project
	CostCenters []model.CostCenter
}

// --- Infrastructure ---

type InfraView struct {
	PageData
	Elements []model.InfrastructureElement
}

// --- Approvals ---

type ApprovalsView struct {
	PageData
	Orders []model.Order
}

// --- Audit ---

type AuditView struct {
	PageData
	Entries     []model.AuditEntry
	Users       []model.User
	UserNames   map[int64]string
	Filter      map[string]string
	FilterQuery string
	Page        int
	TotalPages  int
	TotalCount  int
}

// --- Profile ---

type ProfileView struct {
	PageData
}

// --- Admin Dashboard ---

type AdminDashboardView struct {
	PageData
	CategoryCount    int
	ProductCount     int
	EnvironmentCount int
	SourceCount      int
	UserCount        int
}

// --- Admin Products ---

type AdminProductsView struct {
	PageData
	Products   []model.Product
	Categories []model.Category
	CatNames   map[int64]string
}

type AdminProductNewView struct {
	PageData
	Categories    []model.Category
	Environments  []model.DeploymentEnvironment
	GitLabSources []model.GitLabSource
}

type AdminProductEditView struct {
	PageData
	Product       *model.Product
	Categories    []model.Category
	Environments  []model.DeploymentEnvironment
	EnvNames      map[int64]string
	ProductEnvs   []model.ProductEnvironment
	Parameters    []model.Parameter
	Translations  []model.ProductTranslation
	WebhooksByEnv map[int64][]model.ProductWebhook
	GitLabSources []model.GitLabSource
}

// --- Admin Environments ---

type AdminEnvironmentsView struct {
	PageData
	Environments []model.DeploymentEnvironment
	Sources      []model.GitLabSource
}

// --- Admin Sources ---

type AdminSourcesView struct {
	PageData
	Sources []model.GitLabSource
}

// --- Admin Cost Centers ---

type AdminCostCentersView struct {
	PageData
	CostCenters []model.CostCenter
}

// --- Admin Currencies ---

type AdminCurrenciesView struct {
	PageData
	Rates map[string]float64
}

// --- Admin Users ---

type AdminUsersView struct {
	PageData
	Users []model.User
}

type AdminUserEditView struct {
	PageData
	EditUser *model.User
}

// --- Admin Parameters ---

type AdminParametersView struct {
	PageData
	Parameters []model.Parameter
}

type AdminCategoryParamsView struct {
	PageData
	Category   *model.Category
	Parameters []model.Parameter
}

// --- Admin SMTP ---

type AdminSMTPView struct {
	PageData
	SMTPConfig model.AppConfig
}

// --- Admin AI Config ---

type AdminAIConfigView struct {
	PageData
	AIConfig model.AppConfig
}

// --- Admin Branding ---

type AdminBrandingView struct {
	PageData
	Branding model.Branding
}
