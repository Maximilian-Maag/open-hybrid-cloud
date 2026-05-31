package handler

import (
	"encoding/csv"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/porr-ag/infra-webshop/internal/i18n"
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
	sources, _ := h.gitlabSources.FindAll(r.Context())
	h.render(w, r, "admin-product-new.html", map[string]any{
		"Categories":    cats,
		"Environments":  envs,
		"GitLabSources": sources,
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
	if file, _, err := r.FormFile("image"); err == nil {
		p.Image, _ = io.ReadAll(file)
		file.Close()
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
	sources, _ := h.gitlabSources.FindAll(r.Context())
	penvs, _ := h.productEnvs.FindByProductID(r.Context(), id)
	envNames := make(map[int64]string, len(envs))
	for _, e := range envs {
		envNames[e.ID] = e.Name
	}
	params, _ := h.parameters.FindByScope(r.Context(), "product", id)
	translations, _ := h.translations.FindByProductID(r.Context(), id)

	// Load webhooks for each environment the product is available in
	webhooksByEnv := make(map[int64][]model.ProductWebhook)
	for _, pe := range penvs {
		whs, _ := h.productWebhooks.FindByProductAndEnv(r.Context(), id, pe.EnvironmentID)
		if len(whs) > 0 {
			webhooksByEnv[pe.EnvironmentID] = whs
		}
	}

	h.render(w, r, "admin-product-edit.html", map[string]any{
		"Product":       p,
		"Categories":    cats,
		"Environments":  envs,
		"EnvNames":      envNames,
		"ProductEnvs":   penvs,
		"Parameters":    params,
		"Translations":  translations,
		"WebhooksByEnv": webhooksByEnv,
		"GitLabSources": sources,
	})
}

func (h *Handler) adminProductEnvironmentCreate(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	environmentID := formInt64(r, "environment_id")
	if environmentID == 0 {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: Umgebung wählen.")
		return
	}
	price, _ := strconv.ParseFloat(r.FormValue("price"), 64)
	currency := r.FormValue("currency")
	if currency == "" {
		currency = "EUR"
	}
	pe := &model.ProductEnvironment{
		ProductID:        productID,
		EnvironmentID:    environmentID,
		Price:            price,
		Currency:         currency,
		CostCenterMode:   model.CostCenterModeProject,
		ForcedCostCenter: false,
	}
	if err := h.productEnvs.Upsert(r.Context(), pe); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Umgebung hinzugefügt.")
}

func (h *Handler) adminProductParameterCreate(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p := &model.Parameter{
		Scope:        model.ParameterScopeProduct,
		ScopeID:      productID,
		Name:         r.FormValue("name"),
		Type:         model.ParameterType(r.FormValue("type")),
		Description:  r.FormValue("description"),
		DefaultValue: r.FormValue("default_value"),
		Required:     r.FormValue("required") == "on",
		Sensitive:    r.FormValue("sensitive") == "on",
	}
	if err := h.parameters.Save(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Eingabevariable hinzugefügt.")
}

func (h *Handler) adminProductParameterDelete(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	paramID, _ := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err := h.parameters.Delete(r.Context(), paramID); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Eingabevariable gelöscht.")
}

func (h *Handler) adminProductParameterDeleteAll(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	params, err := h.parameters.FindByScope(r.Context(), model.ParameterScopeProduct, productID)
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	for _, p := range params {
		_ = h.parameters.Delete(r.Context(), p.ID)
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Alle Eingabevariablen gelöscht.")
}

func (h *Handler) adminProductUpdate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		r.ParseForm() //nolint:errcheck
	}
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	p.CategoryID = formInt64(r, "category_id")
	if file, _, err := r.FormFile("image"); err == nil {
		p.Image, _ = io.ReadAll(file)
		file.Close()
	}
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
	h.auditLogFiltered(w, r)
}

func (h *Handler) auditExport(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	entries, _ := h.audit.List(r.Context(), service.AuditFilter{})

	switch format {
	case "pdf":
		h.auditExportPDF(w, entries)
	default:
		h.auditExportCSV(w, entries)
	}
}

func (h *Handler) auditExportCSV(w http.ResponseWriter, entries []model.AuditEntry) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit.csv"`)
	wr := csv.NewWriter(w)
	_ = wr.Write([]string{"timestamp", "action", "entity_id", "user_id", "details"})
	for _, e := range entries {
		_ = wr.Write([]string{
			e.CreatedAt.Format(time.RFC3339),
			string(e.Action),
			strconv.FormatInt(e.EntityID, 10),
			strconv.FormatInt(e.UserID, 10),
			e.Details,
		})
	}
	wr.Flush()
}

func (h *Handler) auditExportPDF(w http.ResponseWriter, entries []model.AuditEntry) {
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 14)
	pdf.Cell(0, 10, "Audit Log")
	pdf.Ln(12)
	pdf.SetFont("Arial", "B", 8)
	for _, col := range []string{"Timestamp", "Action", "Entity", "User", "Details"} {
		pdf.CellFormat(50, 7, col, "1", 0, "", false, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Arial", "", 7)
	for _, e := range entries {
		pdf.CellFormat(45, 6, e.CreatedAt.Format("02.01.2006 15:04"), "1", 0, "", false, 0, "")
		pdf.CellFormat(60, 6, string(e.Action), "1", 0, "", false, 0, "")
		pdf.CellFormat(20, 6, strconv.FormatInt(e.EntityID, 10), "1", 0, "", false, 0, "")
		pdf.CellFormat(20, 6, strconv.FormatInt(e.UserID, 10), "1", 0, "", false, 0, "")
		pdf.CellFormat(0, 6, e.Details, "1", 1, "", false, 0, "")
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="audit.pdf"`)
	_ = pdf.Output(w)
}

// ---- Currencies ----

func (h *Handler) adminCurrencies(w http.ResponseWriter, r *http.Request) {
	var rates map[string]float64
	if h.exchange != nil {
		rates = h.exchange.RatesSnapshot()
	}
	h.render(w, r, "admin-currencies.html", map[string]any{"Rates": rates})
}

func (h *Handler) adminCurrencyRefresh(w http.ResponseWriter, r *http.Request) {
	if h.exchange == nil {
		h.redirectWithFlash(w, r, "/admin/currencies", "error", "Exchange rate service not configured.")
		return
	}
	rates, err := h.exchange.Refresh(r.Context())
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/currencies", "error", "Refresh failed: "+err.Error())
		return
	}
	if h.exchangeRates != nil {
		_ = h.exchangeRates.SaveAll(r.Context(), rates)
	}
	h.redirectWithFlash(w, r, "/admin/currencies", "success", "Exchange rates refreshed.")
}

// ---- Product Image ----

func (h *Handler) productImage(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil || len(p.Image) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(p.Image))
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(p.Image)
}

func (h *Handler) adminProductImageUploadPage(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.NotFound(w, r)
		return
	}
	h.render(w, r, "admin-product-edit.html", map[string]any{"Product": p})
}

func (h *Handler) adminProductImageUpload(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.NotFound(w, r)
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "error", "No image file.")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "error", "Read error.")
		return
	}
	p.Image = data
	if err := h.products.Update(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "error", "Save error.")
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "success", "Image uploaded.")
}

// ---- AI Translation ----

func (h *Handler) adminProductTranslate(w http.ResponseWriter, r *http.Request) {
	if h.translator == nil {
		h.redirectWithFlash(w, r, "/admin/products", "error", "AI translation not configured.")
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p, _ := h.products.GetByID(r.Context(), id, "de")
	if p == nil {
		http.NotFound(w, r)
		return
	}
	if p.BaseLanguage != "de" {
		p, _ = h.products.GetByID(r.Context(), id, p.BaseLanguage)
		if p == nil {
			http.NotFound(w, r)
			return
		}
	}
	targetLangs := make([]string, 0, len(i18n.Supported()))
	for _, l := range i18n.Supported() {
		if l != p.BaseLanguage {
			targetLangs = append(targetLangs, l)
		}
	}
	results, err := h.translator.Translate(r.Context(), p.Name, p.Description, p.BaseLanguage, targetLangs)
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "error", "Translation failed: "+err.Error())
		return
	}
	for lang, t := range results {
		_ = h.translations.Upsert(r.Context(), &model.ProductTranslation{
			ProductID:    id,
			LanguageCode: lang,
			Name:         t.Name,
			Description:  t.Description,
		})
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(id, 10), "success",
		strconv.Itoa(len(results))+" translations generated.")
}

// ---- Product webhooks ----

func (h *Handler) adminProductWebhookCreate(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	pw := &model.ProductWebhook{
		ProductID:     productID,
		EnvironmentID: formInt64(r, "environment_id"),
		Name:          r.FormValue("name"),
		WebhookURL:    r.FormValue("webhook_url"),
		WebhookToken:  r.FormValue("webhook_token"),
		ExecOrder:     formInt(r, "exec_order"),
	}
	if err := h.productWebhooks.Save(r.Context(), pw); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Webhook gespeichert.")
}

func (h *Handler) adminProductWebhookDelete(w http.ResponseWriter, r *http.Request) {
	productID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	wid, _ := strconv.ParseInt(r.PathValue("wid"), 10, 64)
	if err := h.productWebhooks.Delete(r.Context(), wid); err != nil {
		h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/products/"+strconv.FormatInt(productID, 10), "success", "Webhook gelöscht.")
}

// ---- Branding ----

func (h *Handler) adminBranding(w http.ResponseWriter, r *http.Request) {
	b := getBrandCache()
	h.render(w, r, "admin-branding.html", map[string]any{"Branding": b})
}

func (h *Handler) adminBrandingSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		r.ParseForm() //nolint:errcheck
	}
	current := getBrandCache()
	if v := r.FormValue("primary_color"); v != "" {
		current.PrimaryColor = v
	}
	if v := r.FormValue("secondary_color"); v != "" {
		current.SecondaryColor = v
	}
	current.ShopName = r.FormValue("shop_name")
	current.ShopSubtitle = r.FormValue("shop_subtitle")
	current.ImprintText = r.FormValue("imprint_text")
	if file, hdr, err := r.FormFile("logo"); err == nil {
		defer file.Close()
		current.LogoData, _ = io.ReadAll(file)
		current.LogoMime = hdr.Header.Get("Content-Type")
		if current.LogoMime == "" {
			current.LogoMime = "image/png"
		}
	}
	if err := h.brandingRepo.Save(r.Context(), &current); err != nil {
		h.redirectWithFlash(w, r, "/admin/branding", "error", "Fehler: "+err.Error())
		return
	}
	setBrandCache(current)
	h.redirectWithFlash(w, r, "/admin/branding", "success", "Design gespeichert.")
}

func (h *Handler) serveBrandingLogo(w http.ResponseWriter, r *http.Request) {
	b := getBrandCache()
	if len(b.LogoData) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", b.LogoMime)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write(b.LogoData) //nolint:errcheck
}

// ---- Impressum ----

func (h *Handler) impressum(w http.ResponseWriter, r *http.Request) {
	h.render(w, r, "impressum.html", nil)
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
