package handler

import (
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/i18n"
	"github.com/porr-ag/infra-webshop/internal/config"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
	"github.com/porr-ag/infra-webshop/ui"
)

// pages holds one pre-parsed template set per page (layout + page file).
// This avoids block-collision when multiple pages define {{define "content"}}.
type pages map[string]*template.Template

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

	categories   repository.CategoryRepository
	environments repository.EnvironmentRepository
	costCenters  repository.CostCenterRepository
	gitlabSources repository.GitLabSourceRepository
	parameters   repository.ParameterRepository
	productEnvs  repository.ProductEnvironmentRepository
	translations repository.ProductTranslationRepository

	pages    pages
	partials *template.Template
}

type Deps struct {
	Cfg          *config.Config
	Sessions     *auth.SessionStore
	OIDC         *auth.OIDCProvider
	Users        service.UserService
	Products     service.ProductService
	Orders       service.OrderService
	Projects     service.ProjectService
	Infra        service.InfrastructureService
	Audit        service.AuditService
	Categories   repository.CategoryRepository
	Environments repository.EnvironmentRepository
	CostCenters  repository.CostCenterRepository
	GitLabSources repository.GitLabSourceRepository
	Parameters   repository.ParameterRepository
	ProductEnvs  repository.ProductEnvironmentRepository
	Translations repository.ProductTranslationRepository
}

func New(d Deps) *Handler {
	return &Handler{
		cfg:           d.Cfg,
		sessions:      d.Sessions,
		oidc:          d.OIDC,
		users:         d.Users,
		products:      d.Products,
		orders:        d.Orders,
		projects:      d.Projects,
		infra:         d.Infra,
		audit:         d.Audit,
		categories:    d.Categories,
		environments:  d.Environments,
		costCenters:   d.CostCenters,
		gitlabSources: d.GitLabSources,
		parameters:    d.Parameters,
		productEnvs:   d.ProductEnvs,
		translations:  d.Translations,
		pages:         mustBuildPages(),
		partials:      mustParsePartials(),
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	req := h.sessions.Require
	admin := func(next http.HandlerFunc) http.Handler {
		return h.sessions.RequireRole("shop_admin", http.HandlerFunc(next))
	}
	duAdmin := func(next http.HandlerFunc) http.Handler {
		return h.sessions.RequireRole("du_admin", http.HandlerFunc(next))
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

	mux.Handle("GET /infrastructure", req(http.HandlerFunc(h.infrastructureList)))
	mux.Handle("POST /infrastructure/{id}/decommission", req(http.HandlerFunc(h.decommission)))

	// DU Admin: approval
	mux.Handle("GET /approvals", duAdmin(h.approvalList))
	mux.Handle("POST /approvals/{id}/approve", duAdmin(h.approvalApprove))
	mux.Handle("POST /approvals/{id}/reject", duAdmin(h.approvalReject))

	// Webshop Admin
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

	mux.Handle("GET /audit", duAdmin(h.auditLog))
}

// mustBuildPages creates one template.Template per page, each containing
// the shared layout + its page file, so {{define "content"}} doesn't collide.
func mustBuildPages() pages {
	pp := pages{}
	entries, err := fs.ReadDir(ui.Templates, "templates/pages")
	if err != nil {
		slog.Error("read pages dir", "err", err)
		return pp
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		t, err := template.New("").Funcs(templateFuncs()).ParseFS(ui.Templates,
			"templates/layout.html",
			"templates/pages/"+name,
		)
		if err != nil {
			slog.Error("parse page template", "page", name, "err", err)
			continue
		}
		pp[name] = t
	}
	return pp
}

// mustParsePartials parses all partials into a single template set for HTMX fragments.
func mustParsePartials() *template.Template {
	tmpl := template.New("").Funcs(templateFuncs())
	entries, _ := fs.ReadDir(ui.Templates, "templates/partials")
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		content, err := fs.ReadFile(ui.Templates, "templates/partials/"+e.Name())
		if err != nil {
			continue
		}
		template.Must(tmpl.New(path.Base(e.Name())).Parse(string(content)))
	}
	return tmpl
}

func templateFuncs() template.FuncMap {
	return template.FuncMap{
		"statusLabel":      statusLabelI18n,
		"statusBadgeClass": statusBadgeClass,
		"hasPrefix":        strings.HasPrefix,
		"t":                i18n.T,
	}
}

// statusLabelI18n translates order status strings using the i18n package.
// Called in templates as: {{statusLabel $.Lang .Status}}
func statusLabelI18n(lang string, s interface{}) string {
	key := "status." + fmt.Sprintf("%s", s)
	result := i18n.T(key, lang)
	if result == key {
		return fmt.Sprintf("%s", s)
	}
	return result
}

func statusBadgeClass(s string) string {
	classes := map[string]string{
		"pending_approval": "badge-warning",
		"approved":         "badge-info",
		"rejected":         "badge-error",
		"provisioning":     "badge-info",
		"completed":        "badge-success",
		"failed":           "badge-error",
		"decommissioning":  "badge-warning",
		"decommissioned":   "badge-ghost",
	}
	if c, ok := classes[s]; ok {
		return c
	}
	return "badge-ghost"
}

