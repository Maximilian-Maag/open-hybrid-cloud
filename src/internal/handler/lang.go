package handler

import (
	"net/http"
	"strings"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/i18n"
)

func (h *Handler) setLang(w http.ResponseWriter, r *http.Request) {
	lang := r.FormValue("lang")
	if !isSupportedLang(lang) {
		lang = "de"
	}
	if sess, ok := h.sessions.Get(r); ok {
		sess.Lang = lang
		if err := h.sessions.Set(w, *sess); err != nil {
			http.Error(w, "session error", http.StatusInternalServerError)
			return
		}
	}
	ref := r.Header.Get("Referer")
	if ref == "" {
		ref = "/"
	}
	http.Redirect(w, r, ref, http.StatusSeeOther)
}

// detectLang returns the best language for this request.
// Priority: session lang → Accept-Language header → "de".
func detectLang(r *http.Request, sessLang string) string {
	if sessLang != "" && isSupportedLang(sessLang) {
		return sessLang
	}
	if lang := parseAcceptLanguage(r.Header.Get("Accept-Language")); lang != "" {
		return lang
	}
	return "de"
}

// parseAcceptLanguage picks the best supported language from the Accept-Language header.
func parseAcceptLanguage(header string) string {
	if header == "" {
		return ""
	}
	for _, part := range strings.Split(header, ",") {
		// Strip quality value (";q=0.9")
		tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		tag = strings.ToLower(tag)
		// Exact match
		if isSupportedLang(tag) {
			return tag
		}
		// Prefix match: "de-AT" → "de"
		if idx := strings.Index(tag, "-"); idx > 0 {
			prefix := tag[:idx]
			if isSupportedLang(prefix) {
				return prefix
			}
		}
	}
	return ""
}

func isSupportedLang(lang string) bool {
	for _, l := range i18n.Supported() {
		if l == lang {
			return true
		}
	}
	return false
}
