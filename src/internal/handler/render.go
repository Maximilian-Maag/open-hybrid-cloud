package handler

import (
	"net/http"
	"sync"

	"github.com/porr-ag/infra-webshop/src/internal/model"
)

// brandCache holds the current branding, hot-reloaded when admin saves.
var (
	brandCache   model.Branding = model.Branding{PrimaryColor: "#131921", SecondaryColor: "#febd69"}
	brandCacheMu sync.RWMutex
)

func setBrandCache(b model.Branding) {
	brandCacheMu.Lock()
	brandCache = b
	brandCacheMu.Unlock()
}

// SetBrandCache is the exported variant for use from outside the package (e.g. main).
func SetBrandCache(b model.Branding) {
	setBrandCache(b)
}

func getBrandCache() model.Branding {
	brandCacheMu.RLock()
	defer brandCacheMu.RUnlock()
	return brandCache
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (h *Handler) redirectWithFlash(w http.ResponseWriter, r *http.Request, to, kind, msg string) {
	h.sessions.SetFlash(w, kind, msg)
	http.Redirect(w, r, to, http.StatusSeeOther)
}

func (h *Handler) lang(r *http.Request) string {
	sess, _ := h.sessions.Get(r)
	var sessLang string
	if sess != nil {
		sessLang = sess.Lang
	}
	return detectLang(r, sessLang)
}
