package handler

import (
	"log/slog"
	"net/http"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/i18n"
)

// Brand holds configurable branding shown in the layout and login page.
type Brand struct {
	Name     string
	Subtitle string
}

// PageData is the base data available in every page template.
type PageData struct {
	Session       *auth.SessionData
	Flash         *auth.FlashData
	Path          string
	Lang          string
	Brand         Brand
	SupportedLangs []string
	Data          any
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

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", PageData{
		Session:        sess,
		Flash:          flash,
		Path:           r.URL.Path,
		Lang:           lang,
		Brand:          Brand{Name: h.cfg.AppName, Subtitle: h.cfg.AppSubtitle},
		SupportedLangs: i18n.Supported(),
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

// lang returns the current request language (used by non-render handlers).
func (h *Handler) lang(r *http.Request) string {
	sess, _ := h.sessions.Get(r)
	var sessLang string
	if sess != nil {
		sessLang = sess.Lang
	}
	return detectLang(r, sessLang)
}
