package handler

import (
	"log/slog"
	"net/http"
	"sync"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/i18n"
	"github.com/porr-ag/infra-webshop/internal/model"
)

type Brand struct {
	Name           string
	Subtitle       string
	PrimaryColor   string
	SecondaryColor string
	HasLogo        bool
}

type PageData struct {
	Session        *auth.SessionData
	Flash          *auth.FlashData
	Path           string
	Lang           string
	Brand          Brand
	SupportedLangs []string
	SearchQuery    string
	Data           any
}

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

func (h *Handler) render(w http.ResponseWriter, r *http.Request, page string, data any) {
	t, ok := h.pages[page]
	if !ok {
		slog.Error("unknown page", "page", page)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	sess, _ := h.sessions.Get(r)
	flash := h.sessions.PopFlash(w, r)

	var sessLang string
	if sess != nil {
		sessLang = sess.Lang
	}
	lang := detectLang(r, sessLang)

	b := getBrandCache()

	var searchQuery string
	if m, ok := data.(map[string]any); ok {
		if q, ok := m["Query"].(string); ok {
			searchQuery = q
		}
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", PageData{
		Session: sess,
		Flash:   flash,
		Path:    r.URL.Path,
		Lang:    lang,
		Brand: Brand{
			Name:           h.cfg.AppName,
			Subtitle:       h.cfg.AppSubtitle,
			PrimaryColor:   b.PrimaryColor,
			SecondaryColor: b.SecondaryColor,
			HasLogo:        len(b.LogoData) > 0,
		},
		SupportedLangs: i18n.Supported(),
		SearchQuery:    searchQuery,
		Data:           data,
	}); err != nil {
		slog.Error("render error", "page", page, "err", err)
	}
}

func (h *Handler) renderPartial(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.partials.ExecuteTemplate(w, name, data); err != nil {
		slog.Error("partial render error", "partial", name, "err", err)
	}
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
