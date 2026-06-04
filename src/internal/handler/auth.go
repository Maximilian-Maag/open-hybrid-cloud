package handler

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/src/internal/auth"
	"github.com/porr-ag/infra-webshop/src/internal/i18n"
	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/view"
	authpages "github.com/porr-ag/infra-webshop/src/ui/pages/auth"
)

func (h *Handler) loginPage(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.sessions.Get(r); ok {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	renderTempl(w, r, authpages.Login(view.LoginView{
		PageData:    h.buildPageData(w, r),
		OIDCEnabled: h.oidc != nil,
	}))
}

func (h *Handler) loginSubmit(w http.ResponseWriter, r *http.Request) {
	lang := h.lang(r)
	ip := remoteIP(r)
	if !h.loginRL.allowed(ip) {
		renderTempl(w, r, authpages.Login(view.LoginView{
			PageData:    h.buildPageData(w, r),
			Error:       i18n.T("flash.login_rate_limit", lang),
			OIDCEnabled: h.oidc != nil,
		}))
		return
	}

	email := r.FormValue("email")
	password := r.FormValue("password")

	u, err := h.users.VerifyPassword(r.Context(), email, password)
	if err != nil || u == nil {
		h.loginRL.record(ip)
		renderTempl(w, r, authpages.Login(view.LoginView{
			PageData:    h.buildPageData(w, r),
			Error:       i18n.T("flash.login_invalid", lang),
			OIDCEnabled: h.oidc != nil,
		}))
		return
	}
	h.loginRL.clear(ip)

	if err := h.sessions.Set(w, auth.SessionData{
		UserID: u.ID,
		Email:  u.Email,
		Name:   u.Name,
		Role:   u.Role,
		Lang:   "de",
	}); err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (h *Handler) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if h.oidc == nil {
		http.Error(w, "OIDC not configured", http.StatusBadRequest)
		return
	}
	claims, err := h.oidc.HandleCallback(r)
	if err != nil {
		http.Error(w, "auth failed: "+err.Error(), http.StatusUnauthorized)
		return
	}

	u, err := h.users.UpsertSSO(r.Context(), claims.Sub, claims.Email, claims.Name, model.RoleAdmin)
	if err != nil || u == nil {
		http.Error(w, "user lookup failed", http.StatusInternalServerError)
		return
	}

	if err := h.sessions.Set(w, auth.SessionData{
		UserID: u.ID,
		Email:  u.Email,
		Name:   u.Name,
		Role:   u.Role,
		Lang:   "de",
	}); err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	h.sessions.Clear(w)
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}
