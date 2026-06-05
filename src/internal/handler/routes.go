package handler

import (
	"context"
	"net/http"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/aitranslation"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/auth"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/exchange"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/notification"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service"
)

type Handler struct {
	cfg      *config.Config
	sessions *auth.SessionStore
	oidc     *auth.OIDCProvider // nil when Entra ID is not configured

	users    service.UserService
	products service.ProductService
	orders   service.OrderService
	projects service.ProjectService
	infra    service.InfrastructureService
	audit    service.AuditService

	categories      repository.CategoryRepository
	environments    repository.EnvironmentRepository
	costCenters     repository.CostCenterRepository
	gitlabSources   repository.GitLabSourceRepository
	parameters      repository.ParameterRepository
	productEnvs     repository.ProductEnvironmentRepository
	translations    repository.ProductTranslationRepository
	productWebhooks repository.ProductWebhookRepository

	notifier      *notification.Service
	exchange      *exchange.Service
	exchangeRates repository.ExchangeRateRepository
	translator    aitranslation.Translator
	brandingRepo  repository.BrandingRepository
	appConfigRepo repository.AppConfigRepository

	loginRL *loginRateLimiter
}

type Deps struct {
	Cfg             *config.Config
	Sessions        *auth.SessionStore
	OIDC            *auth.OIDCProvider
	Users           service.UserService
	Products        service.ProductService
	Orders          service.OrderService
	Projects        service.ProjectService
	Infra           service.InfrastructureService
	Audit           service.AuditService
	Categories      repository.CategoryRepository
	Environments    repository.EnvironmentRepository
	CostCenters     repository.CostCenterRepository
	GitLabSources   repository.GitLabSourceRepository
	Parameters      repository.ParameterRepository
	ProductEnvs     repository.ProductEnvironmentRepository
	Translations    repository.ProductTranslationRepository
	ProductWebhooks repository.ProductWebhookRepository
	Notifier        *notification.Service
	Exchange        *exchange.Service
	ExchangeRates   repository.ExchangeRateRepository
	Translator      aitranslation.Translator
	BrandingRepo    repository.BrandingRepository
	AppConfigRepo   repository.AppConfigRepository
}

func New(d Deps) *Handler {
	h := &Handler{
		cfg:             d.Cfg,
		sessions:        d.Sessions,
		oidc:            d.OIDC,
		users:           d.Users,
		products:        d.Products,
		orders:          d.Orders,
		projects:        d.Projects,
		infra:           d.Infra,
		audit:           d.Audit,
		categories:      d.Categories,
		environments:    d.Environments,
		costCenters:     d.CostCenters,
		gitlabSources:   d.GitLabSources,
		parameters:      d.Parameters,
		productEnvs:     d.ProductEnvs,
		translations:    d.Translations,
		productWebhooks: d.ProductWebhooks,
		notifier:        d.Notifier,
		exchange:        d.Exchange,
		exchangeRates:   d.ExchangeRates,
		translator:      d.Translator,
		brandingRepo:    d.BrandingRepo,
		appConfigRepo:   d.AppConfigRepo,
		loginRL:         newLoginRateLimiter(),
	}
	if d.BrandingRepo != nil {
		if b, err := d.BrandingRepo.Load(context.Background()); err == nil {
			setBrandCache(*b)
		}
	}
	return h
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	req := h.sessions.Require
	admin := func(next http.HandlerFunc) http.Handler {
		return h.sessions.RequireRole("root", http.HandlerFunc(next))
	}
	duAdmin := func(next http.HandlerFunc) http.Handler {
		return h.sessions.RequireRole("admin", http.HandlerFunc(next))
	}

	// Public
	mux.HandleFunc("GET /login", h.loginPage)
	mux.HandleFunc("POST /login", h.loginSubmit)
	mux.HandleFunc("GET /auth/callback", h.oidcCallback)
	mux.HandleFunc("POST /logout", h.logout)
	mux.Handle("POST /lang", req(http.HandlerFunc(h.setLang)))

	// Authenticated
	mux.Handle("GET /{$}", req(http.HandlerFunc(h.home)))
	mux.Handle("GET /catalog", req(http.HandlerFunc(h.catalog)))
	mux.Handle("GET /catalog/{id}", req(http.HandlerFunc(h.catalogProduct)))

	mux.Handle("GET /orders", req(http.HandlerFunc(h.orderList)))
	mux.Handle("GET /orders/new", req(http.HandlerFunc(h.orderNew)))
	mux.Handle("POST /orders/new", req(http.HandlerFunc(h.orderCreate)))
	mux.Handle("GET /orders/{id}", req(http.HandlerFunc(h.orderDetail)))

	mux.Handle("GET /projects", req(http.HandlerFunc(h.projectList)))
	mux.Handle("GET /projects/new", req(http.HandlerFunc(h.projectNew)))
	mux.Handle("POST /projects/new", req(http.HandlerFunc(h.projectCreate)))
	mux.Handle("GET /projects/{id}", req(http.HandlerFunc(h.projectDetail)))
	mux.Handle("POST /projects/{id}", req(http.HandlerFunc(h.projectUpdate)))
	mux.Handle("POST /projects/{id}/delete", req(http.HandlerFunc(h.projectDelete)))

	mux.Handle("GET /infrastructure", req(http.HandlerFunc(h.infrastructureList)))
	mux.Handle("POST /infrastructure/{id}/decommission", req(http.HandlerFunc(h.decommission)))

	// Admin & Shop Admin: approval
	mux.Handle("GET /approvals", duAdmin(h.approvalList))
	mux.Handle("POST /approvals/{id}/approve", duAdmin(h.approvalApprove))
	mux.Handle("POST /approvals/{id}/reject", duAdmin(h.approvalReject))

	// Root
	mux.Handle("GET /admin", admin(h.adminDashboard))
	mux.Handle("GET /admin/categories", admin(h.adminCategories))
	mux.Handle("POST /admin/categories", admin(h.adminCategoryCreate))
	mux.Handle("POST /admin/categories/{id}/delete", admin(h.adminCategoryDelete))

	mux.Handle("GET /admin/products", admin(h.adminProducts))
	mux.Handle("GET /admin/products/new", admin(h.adminProductNew))
	mux.Handle("POST /admin/products/new", admin(h.adminProductCreate))
	mux.Handle("GET /admin/products/{id}", admin(h.adminProductEdit))
	mux.Handle("POST /admin/products/{id}", admin(h.adminProductUpdate))
	mux.Handle("POST /admin/products/{id}/delete", admin(h.adminProductDelete))

	mux.Handle("GET /admin/environments", admin(h.adminEnvironments))
	mux.Handle("POST /admin/environments", admin(h.adminEnvironmentCreate))
	mux.Handle("POST /admin/environments/{id}/delete", admin(h.adminEnvironmentDelete))

	mux.Handle("GET /admin/sources", admin(h.adminSources))
	mux.Handle("POST /admin/sources", admin(h.adminSourceCreate))
	mux.Handle("POST /admin/sources/{id}/delete", admin(h.adminSourceDelete))

	mux.Handle("GET /admin/costcenters", admin(h.adminCostCenters))
	mux.Handle("POST /admin/costcenters", admin(h.adminCostCenterCreate))
	mux.Handle("POST /admin/costcenters/{id}/delete", admin(h.adminCostCenterDelete))

	mux.Handle("GET /admin/users", admin(h.adminUsers))
	mux.Handle("POST /admin/users", admin(h.adminUserCreate))
	mux.Handle("GET /admin/users/{id}/edit", admin(h.adminUserEdit))
	mux.Handle("POST /admin/users/{id}/edit", admin(h.adminUserUpdate))
	mux.Handle("POST /admin/users/{id}/deactivate", admin(h.adminUserDeactivate))
	mux.Handle("POST /admin/users/{id}/delete", admin(h.adminUserDelete))

	mux.Handle("GET /admin/currencies", admin(h.adminCurrencies))
	mux.Handle("POST /admin/currencies/refresh", admin(h.adminCurrencyRefresh))

	mux.Handle("POST /admin/products/{id}/translate", admin(h.adminProductTranslate))
	mux.Handle("GET /admin/products/{id}/image", admin(h.adminProductImageUploadPage))
	mux.Handle("POST /admin/products/{id}/image", admin(h.adminProductImageUpload))

	mux.Handle("GET /admin/gitlab/projects", admin(h.gitlabProjects))
	mux.Handle("GET /admin/gitlab/branches", admin(h.gitlabBranches))
	mux.Handle("GET /admin/gitlab/files", admin(h.gitlabFiles))
	mux.Handle("POST /admin/gitlab/import-vars", admin(h.gitlabImportVars))

	mux.Handle("POST /admin/products/{id}/webhooks", admin(h.adminProductWebhookCreate))
	mux.Handle("POST /admin/products/{id}/environments", admin(h.adminProductEnvironmentCreate))
	mux.Handle("POST /admin/products/{id}/parameters", admin(h.adminProductParameterCreate))
	mux.Handle("POST /admin/products/{id}/parameters/delete-all", admin(h.adminProductParameterDeleteAll))
	mux.Handle("POST /admin/products/{id}/parameters/{pid}/delete", admin(h.adminProductParameterDelete))
	mux.Handle("POST /admin/products/{id}/webhooks/{wid}/delete", admin(h.adminProductWebhookDelete))

	mux.Handle("GET /admin/parameters", admin(h.adminParameters))
	mux.Handle("POST /admin/parameters", admin(h.adminParameterCreate))
	mux.Handle("POST /admin/parameters/{id}/delete", admin(h.adminParameterDelete))

	mux.Handle("GET /admin/categories/{id}/parameters", admin(h.adminCategoryParameters))
	mux.Handle("POST /admin/categories/{id}/parameters", admin(h.adminCategoryParameterCreate))
	mux.Handle("POST /admin/categories/{id}/parameters/{pid}/delete", admin(h.adminCategoryParameterDelete))

	mux.Handle("GET /admin/smtp", admin(h.adminSMTP))
	mux.Handle("POST /admin/smtp", admin(h.adminSMTPSave))

	mux.Handle("GET /admin/ai-config", admin(h.adminAIConfig))
	mux.Handle("POST /admin/ai-config", admin(h.adminAIConfigSave))

	mux.Handle("GET /admin/branding", admin(h.adminBranding))
	mux.Handle("POST /admin/branding", admin(h.adminBrandingSave))
	mux.Handle("GET /branding/logo", req(http.HandlerFunc(h.serveBrandingLogo)))
	mux.Handle("GET /impressum", req(http.HandlerFunc(h.impressum)))

	mux.Handle("GET /products/{id}/image", req(http.HandlerFunc(h.productImage)))

	mux.Handle("GET /settings/profile", req(http.HandlerFunc(h.profilePage)))
	mux.Handle("POST /settings/profile", req(http.HandlerFunc(h.profileUpdate)))

	mux.Handle("GET /audit", duAdmin(h.auditLog))
	mux.Handle("GET /audit/export", duAdmin(h.auditExport))
}
