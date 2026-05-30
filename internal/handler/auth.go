package handler

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/model"
)

func (h *Handler) loginPage(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.sessions.Get(r); ok {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	h.render(w, r, "login.html", map[string]any{
		"OIDCEnabled": h.oidc != nil,
	})
}

func (h *Handler) loginSubmit(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")

	u, err := h.users.VerifyPassword(r.Context(), email, password)
	if err != nil || u == nil {
		h.render(w, r, "login.html", map[string]any{
			"Error":       "Ungültige E-Mail oder Passwort.",
			"OIDCEnabled": h.oidc != nil,
		})
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
