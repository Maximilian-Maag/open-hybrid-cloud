package handler

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/internal/i18n"
)

func (h *Handler) setLang(w http.ResponseWriter, r *http.Request) {
	lang := r.FormValue("lang")
	supported := i18n.Supported()
	valid := false
	for _, l := range supported {
		if l == lang {
			valid = true
			break
		}
	}
	if !valid {
		lang = "de"
	}

	if sess, ok := h.sessions.Get(r); ok {
		sess.Lang = lang
		h.sessions.Set(w, *sess)
	}

	ref := r.Header.Get("Referer")
	if ref == "" {
		ref = "/"
	}
	http.Redirect(w, r, ref, http.StatusSeeOther)
}
