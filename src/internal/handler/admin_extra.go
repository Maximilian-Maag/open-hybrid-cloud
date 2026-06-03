package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/porr-ag/infra-webshop/src/internal/aitranslation"
	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/service"
	"github.com/porr-ag/infra-webshop/src/internal/view"
	adminpages "github.com/porr-ag/infra-webshop/src/ui/pages/admin"
	auditpages "github.com/porr-ag/infra-webshop/src/ui/pages/audit"
)

// ---- User edit / deactivate ----

func (h *Handler) adminUserEdit(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	u, _ := h.users.GetByID(r.Context(), id)
	if u == nil {
		http.NotFound(w, r)
		return
	}
	renderTempl(w, r, adminpages.AdminUserEdit(view.AdminUserEditView{
		PageData: h.buildPageData(w, r),
		EditUser: u,
	}))
}

func (h *Handler) adminUserUpdate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	u, _ := h.users.GetByID(r.Context(), id)
	if u == nil {
		http.NotFound(w, r)
		return
	}
	u.Name = r.FormValue("name")
	u.Email = r.FormValue("email")
	u.Role = model.Role(r.FormValue("role"))
	if err := h.users.Update(r.Context(), u); err != nil {
		h.redirectWithFlash(w, r, "/admin/users/"+strconv.FormatInt(id, 10)+"/edit", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/users", "success", "Benutzer aktualisiert.")
}

func (h *Handler) adminUserDeactivate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.users.SetActive(r.Context(), id, false); err != nil {
		h.redirectWithFlash(w, r, "/admin/users", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/users", "success", "Benutzer deaktiviert.")
}

func (h *Handler) adminUserDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.users.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/users", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/users", "success", "Benutzer gelöscht.")
}

// ---- Global parameters ----

func (h *Handler) adminParameters(w http.ResponseWriter, r *http.Request) {
	params, _ := h.parameters.FindByScope(r.Context(), model.ParameterScopeGlobal, 0)
	renderTempl(w, r, adminpages.AdminParameters(view.AdminParametersView{
		PageData:   h.buildPageData(w, r),
		Parameters: params,
	}))
}

func (h *Handler) adminParameterCreate(w http.ResponseWriter, r *http.Request) {
	p := &model.Parameter{
		Scope:        model.ParameterScopeGlobal,
		ScopeID:      0,
		Name:         r.FormValue("name"),
		Type:         model.ParameterType(r.FormValue("type")),
		Description:  r.FormValue("description"),
		DefaultValue: r.FormValue("default_value"),
		Required:     r.FormValue("required") == "on",
		Sensitive:    r.FormValue("sensitive") == "on",
	}
	if err := h.parameters.Save(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/admin/parameters", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/parameters", "success", "Parameter erstellt.")
}

func (h *Handler) adminParameterDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := h.parameters.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/admin/parameters", "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/admin/parameters", "success", "Parameter gelöscht.")
}

// ---- Category parameters ----

func (h *Handler) adminCategoryParameters(w http.ResponseWriter, r *http.Request) {
	catID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	cat, _ := h.categories.FindByID(r.Context(), catID)
	if cat == nil {
		http.NotFound(w, r)
		return
	}
	params, _ := h.parameters.FindByScope(r.Context(), model.ParameterScopeCategory, catID)
	renderTempl(w, r, adminpages.AdminCategoryParams(view.AdminCategoryParamsView{
		PageData:   h.buildPageData(w, r),
		Category:   cat,
		Parameters: params,
	}))
}

func (h *Handler) adminCategoryParameterCreate(w http.ResponseWriter, r *http.Request) {
	catID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	p := &model.Parameter{
		Scope:        model.ParameterScopeCategory,
		ScopeID:      catID,
		Name:         r.FormValue("name"),
		Type:         model.ParameterType(r.FormValue("type")),
		Description:  r.FormValue("description"),
		DefaultValue: r.FormValue("default_value"),
		Required:     r.FormValue("required") == "on",
		Sensitive:    r.FormValue("sensitive") == "on",
	}
	back := "/admin/categories/" + strconv.FormatInt(catID, 10) + "/parameters"
	if err := h.parameters.Save(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, back, "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, back, "success", "Parameter erstellt.")
}

func (h *Handler) adminCategoryParameterDelete(w http.ResponseWriter, r *http.Request) {
	catID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	pid, _ := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	back := "/admin/categories/" + strconv.FormatInt(catID, 10) + "/parameters"
	if err := h.parameters.Delete(r.Context(), pid); err != nil {
		h.redirectWithFlash(w, r, back, "error", "Fehler: "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, back, "success", "Parameter gelöscht.")
}

// ---- SMTP config ----

func (h *Handler) adminSMTP(w http.ResponseWriter, r *http.Request) {
	var cfg model.AppConfig
	if h.appConfigRepo != nil {
		if c, err := h.appConfigRepo.Load(r.Context()); err == nil {
			cfg = *c
		}
	}
	renderTempl(w, r, adminpages.AdminSMTP(view.AdminSMTPView{
		PageData:   h.buildPageData(w, r),
		SMTPConfig: cfg,
	}))
}

func (h *Handler) adminSMTPSave(w http.ResponseWriter, r *http.Request) {
	if h.appConfigRepo == nil {
		h.redirectWithFlash(w, r, "/admin/smtp", "error", "Config repository not available.")
		return
	}
	c, _ := h.appConfigRepo.Load(r.Context())
	if c == nil {
		c = &model.AppConfig{}
	}
	c.SMTPHost = r.FormValue("smtp_host")
	c.SMTPPort = r.FormValue("smtp_port")
	if c.SMTPPort == "" {
		c.SMTPPort = "587"
	}
	c.SMTPFrom = r.FormValue("smtp_from")
	c.SMTPUsername = r.FormValue("smtp_username")
	if pwd := r.FormValue("smtp_password"); pwd != "" {
		c.SMTPPassword = pwd
	}
	c.SMTPTLS = r.FormValue("smtp_tls") == "on"

	if err := h.appConfigRepo.Save(r.Context(), c); err != nil {
		h.redirectWithFlash(w, r, "/admin/smtp", "error", "Fehler: "+err.Error())
		return
	}
	if h.notifier != nil {
		h.notifier.Reconfigure(c.SMTPHost, c.SMTPPort, c.SMTPFrom, c.SMTPUsername, c.SMTPPassword, c.SMTPTLS)
	}
	h.redirectWithFlash(w, r, "/admin/smtp", "success", "SMTP-Konfiguration gespeichert.")
}

// ---- AI translation config ----

func (h *Handler) adminAIConfig(w http.ResponseWriter, r *http.Request) {
	var cfg model.AppConfig
	if h.appConfigRepo != nil {
		if c, err := h.appConfigRepo.Load(r.Context()); err == nil {
			cfg = *c
		}
	}
	renderTempl(w, r, adminpages.AdminAIConfig(view.AdminAIConfigView{
		PageData: h.buildPageData(w, r),
		AIConfig: cfg,
	}))
}

func (h *Handler) adminAIConfigSave(w http.ResponseWriter, r *http.Request) {
	if h.appConfigRepo == nil {
		h.redirectWithFlash(w, r, "/admin/ai-config", "error", "Config repository not available.")
		return
	}
	c, _ := h.appConfigRepo.Load(r.Context())
	if c == nil {
		c = &model.AppConfig{}
	}
	c.AIProvider = r.FormValue("ai_provider")
	c.AIEndpoint = r.FormValue("ai_endpoint")
	if key := r.FormValue("ai_api_key"); key != "" {
		c.AIAPIKey = key
	}
	c.AIModel = r.FormValue("ai_model")

	if err := h.appConfigRepo.Save(r.Context(), c); err != nil {
		h.redirectWithFlash(w, r, "/admin/ai-config", "error", "Fehler: "+err.Error())
		return
	}
	h.translator = aitranslation.NewTranslator(c.AIProvider, c.AIEndpoint, c.AIAPIKey, c.AIModel)
	h.redirectWithFlash(w, r, "/admin/ai-config", "success", "KI-Konfiguration gespeichert.")
}

// ---- Audit log with filter ----

const auditPerPage = 50

func (h *Handler) auditLogFiltered(w http.ResponseWriter, r *http.Request) {
	filter := service.AuditFilter{}
	q := r.URL.Query()

	if uid := q.Get("user_id"); uid != "" {
		filter.UserID, _ = strconv.ParseInt(uid, 10, 64)
	}
	if action := q.Get("action"); action != "" {
		filter.Action = model.AuditAction(action)
	}
	if from := q.Get("from"); from != "" {
		if t, err := time.Parse("2006-01-02", from); err == nil {
			filter.From = &t
		}
	}
	if to := q.Get("to"); to != "" {
		if t, err := time.Parse("2006-01-02", to); err == nil {
			end := t.Add(24*time.Hour - time.Second)
			filter.To = &end
		}
	}

	allEntries, _ := h.audit.List(r.Context(), filter)
	users, _ := h.users.ListAll(r.Context())

	userNames := make(map[int64]string, len(users))
	for _, u := range users {
		userNames[u.ID] = u.Name
	}

	totalCount := len(allEntries)
	totalPages := (totalCount + auditPerPage - 1) / auditPerPage
	if totalPages == 0 {
		totalPages = 1
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}

	start := (page - 1) * auditPerPage
	end := start + auditPerPage
	if end > totalCount {
		end = totalCount
	}
	pageEntries := allEntries[start:end]

	filterQuery := "user_id=" + q.Get("user_id") +
		"&action=" + q.Get("action") +
		"&from=" + q.Get("from") +
		"&to=" + q.Get("to")

	filterMap := map[string]string{
		"user_id": q.Get("user_id"),
		"action":  q.Get("action"),
		"from":    q.Get("from"),
		"to":      q.Get("to"),
	}

	renderTempl(w, r, auditpages.AuditLog(view.AuditView{
		PageData:    h.buildPageData(w, r),
		Entries:     pageEntries,
		Users:       users,
		UserNames:   userNames,
		Filter:      filterMap,
		FilterQuery: filterQuery,
		Page:        page,
		TotalPages:  totalPages,
		TotalCount:  totalCount,
	}))
}
