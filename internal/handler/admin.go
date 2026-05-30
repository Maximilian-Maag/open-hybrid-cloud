package handler

import (
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/service"
)

func (h *Handler) adminDashboard(w http.ResponseWriter, r *http.Request) {
	cats, _ := h.categories.FindAll(r.Context())
	prods, _ := h.products.ListAll(r.Context(), "de")
	envs, _ := h.environments.FindAll(r.Context())
	sources, _ := h.gitlabSources.FindAll(r.Context())
	users, _ := h.users.ListAll(r.Context())
	h.render(w, r, "admin-dashboard.html", map[string]any{
		"CategoryCount":    len(cats),
		"ProductCount":     len(prods),
		"EnvironmentCount": len(envs),
		"SourceCount":      len(sources),
		"UserCount":        len(users),
	})
}

// ---- Categories ----

func (h *Handler) adminCategories(w http.ResponseWriter, r *http.Request) {
	cats, _ := h.categories.FindAll(r.Context())
	h.render(w, r, "admin-categories.html", map[string]any{"Categories": cats})
}

func (h *Handler) adminCategoryCreate(w http.ResponseWriter, r *http.Request) {
	c := &model.Category{
		Name:         r.FormValue("name"),
		DisplayOrder: formInt(r, "display_order"),
	}
	if err := h.categories.Save(r.Context(), c); err != nil {
		h.redirectWithFlash(w, r, "/admin/categories", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/categories", "success", "Kategorie erstellt.")
}

func (h *Handler) adminCategoryDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.categories.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/categories", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/categories", "success", "Kategorie gelöscht.")
}

// ---- Products ----

func (h *Handler) adminProducts(w http.ResponseWriter, r *http.Request) {
	prods, _ := h.products.ListAll(r.Context(), "de")
	cats, _ := h.categories.FindAll(r.Context())
	h.render(w, r, "admin-products.html", map[string]any{
		"Products":   prods,
		"Categories": cats,
	})
}

func (h *Handler) adminProductNew(w http.ResponseWriter, r *http.Request) {
	cats, _ := h.categories.FindAll(r.Context())
	envs, _ := h.environments.FindAll(r.Context())
	h.render(w, r, "admin-product-new.html", map[string]any{
		"Categories":   cats,
		"Environments": envs,
	})
}

func (h *Handler) adminProductCreate(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p := &model.Product{
		CategoryID:   formInt64(r, "category_id"),
		BaseLanguage: "de",
	}
	if err := h.products.Save(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/new", "error", "Fehler: "+err.Error())
		return
	}
	_ = h.translations.Upsert(r.Context(), &model.ProductTranslation{
		ProductID:    p.ID,
		LanguageCode: "de",
		Name:         r.FormValue("name"),
		Description:  r.FormValue("description"),
	})
	h.redirectWithFlash(w, r, "/admin/products", "success", "Produkt erstellt.")
}

func (h *Handler) adminProductEdit(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	cats, _ := h.categories.FindAll(r.Context())
	envs, _ := h.environments.FindAll(r.Context())
	penvs, _ := h.productEnvs.FindByProductID(r.Context(), id)
	params, _ := h.parameters.FindByScope(r.Context(), "product", id)
	translations, _ := h.translations.FindByProductID(r.Context(), id)
	h.render(w, r, "admin-product-edit.html", map[string]any{
		"Product":      p,
		"Categories":   cats,
		"Environments": envs,
		"ProductEnvs":  penvs,
		"Parameters":   params,
		"Translations": translations,
	})
}

func (h *Handler) adminProductUpdate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	p.CategoryID = formInt64(r, "category_id")
	if err := h.products.Update(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "error", "Fehler: "+err.Error())
		return
	}
	_ = h.translations.Upsert(r.Context(), &model.ProductTranslation{
		ProductID:    id,
		LanguageCode: "de",
		Name:         r.FormValue("name"),
		Description:  r.FormValue("description"),
	})
	h.redirectWithFlash(w, r, "/admin/products", "success", "Produkt gespeichert.")
}

func (h *Handler) adminProductDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.products.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/products", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products", "success", "Produkt gelöscht.")
}

// ---- Environments ----

func (h *Handler) adminEnvironments(w http.ResponseWriter, r *http.Request) {
	envs, _ := h.environments.FindAll(r.Context())
	sources, _ := h.gitlabSources.FindAll(r.Context())
	h.render(w, r, "admin-environments.html", map[string]any{
		"Environments": envs,
		"Sources":      sources,
	})
}

func (h *Handler) adminEnvironmentCreate(w http.ResponseWriter, r *http.Request) {
	env := &model.DeploymentEnvironment{
		Name:           r.FormValue("name"),
		Description:    r.FormValue("description"),
		GitLabSourceID: formInt64(r, "gitlab_source_id"),
		WebhookURL:     r.FormValue("webhook_url"),
		WebhookToken:   r.FormValue("webhook_token"),
	}
	if err := h.environments.Save(r.Context(), env); err != nil {
		h.redirectWithFlash(w, r, "/admin/environments", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/environments", "success", "Umgebung erstellt.")
}

func (h *Handler) adminEnvironmentDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.environments.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/environments", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/environments", "success", "Umgebung gelöscht.")
}

// ---- GitLab Sources ----

func (h *Handler) adminSources(w http.ResponseWriter, r *http.Request) {
	sources, _ := h.gitlabSources.FindAll(r.Context())
	h.render(w, r, "admin-sources.html", map[string]any{"Sources": sources})
}

func (h *Handler) adminSourceCreate(w http.ResponseWriter, r *http.Request) {
	s := &model.GitLabSource{
		Name:        r.FormValue("name"),
		URL:         r.FormValue("url"),
		AccessToken: r.FormValue("access_token"),
	}
	if err := h.gitlabSources.Save(r.Context(), s); err != nil {
		h.redirectWithFlash(w, r, "/admin/sources", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/sources", "success", "GitLab-Quelle erstellt.")
}

func (h *Handler) adminSourceDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.gitlabSources.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/sources", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/sources", "success", "Quelle gelöscht.")
}

// ---- Cost Centers ----

func (h *Handler) adminCostCenters(w http.ResponseWriter, r *http.Request) {
	ccs, _ := h.costCenters.FindAll(r.Context())
	h.render(w, r, "admin-costcenters.html", map[string]any{"CostCenters": ccs})
}

func (h *Handler) adminCostCenterCreate(w http.ResponseWriter, r *http.Request) {
	cc := &model.CostCenter{
		Code:   r.FormValue("code"),
		Name:   r.FormValue("name"),
		Active: true,
	}
	if err := h.costCenters.Save(r.Context(), cc); err != nil {
		h.redirectWithFlash(w, r, "/admin/costcenters", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/costcenters", "success", "Kostenstelle erstellt.")
}

func (h *Handler) adminCostCenterDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	cc, _ := h.costCenters.FindByID(r.Context(), id)
	if cc == nil {
		h.redirectWithFlash(w, r, "/admin/costcenters", "error", "Kostenstelle nicht gefunden.")
		return
	}
	cc.Active = false
	if err := h.costCenters.Update(r.Context(), cc); err != nil {
		h.redirectWithFlash(w, r, "/admin/costcenters", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/costcenters", "success", "Kostenstelle deaktiviert.")
}

// ---- Users ----

func (h *Handler) adminUsers(w http.ResponseWriter, r *http.Request) {
	users, _ := h.users.ListAll(r.Context())
	h.render(w, r, "admin-users.html", map[string]any{"Users": users})
}

func (h *Handler) adminUserCreate(w http.ResponseWriter, r *http.Request) {
	u := &model.User{
		Email: r.FormValue("email"),
		Name:  r.FormValue("name"),
		Role:  model.Role(r.FormValue("role")),
	}
	if err := h.users.Create(r.Context(), u, r.FormValue("password")); err != nil {
		h.redirectWithFlash(w, r, "/admin/users", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/users", "success", "Benutzer erstellt.")
}

// ---- Audit ----

func (h *Handler) auditLog(w http.ResponseWriter, r *http.Request) {
	entries, _ := h.audit.List(r.Context(), service.AuditFilter{})
	h.render(w, r, "audit.html", map[string]any{"Entries": entries})
}

// ---- Helpers ----

func formInt(r *http.Request, key string) int {
	v, _ := strconv.Atoi(r.FormValue(key))
	return v
}

func formInt64(r *http.Request, key string) int64 {
	v, _ := strconv.ParseInt(r.FormValue(key), 10, 64)
	return v
}
