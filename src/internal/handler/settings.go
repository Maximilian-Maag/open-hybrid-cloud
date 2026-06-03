package handler

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/src/internal/view"
	settingspages "github.com/porr-ag/infra-webshop/src/ui/pages/settings"
)

func (h *Handler) profilePage(w http.ResponseWriter, r *http.Request) {
	renderTempl(w, r, settingspages.Profile(view.ProfileView{
		PageData: h.buildPageData(w, r),
	}))
}

func (h *Handler) profileUpdate(w http.ResponseWriter, r *http.Request) {
	sess, ok := h.sessions.Get(r)
	if !ok || sess == nil {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	current := r.FormValue("current_password")
	newPwd := r.FormValue("new_password")
	confirm := r.FormValue("confirm_password")

	if newPwd != confirm {
		h.redirectWithFlash(w, r, "/settings/profile", "error", "New passwords do not match.")
		return
	}
	if len(newPwd) < 8 {
		h.redirectWithFlash(w, r, "/settings/profile", "error", "Password must be at least 8 characters.")
		return
	}

	if err := h.users.ChangePassword(r.Context(), sess.UserID, current, newPwd); err != nil {
		h.redirectWithFlash(w, r, "/settings/profile", "error", err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/settings/profile", "success", "Password changed successfully.")
}
