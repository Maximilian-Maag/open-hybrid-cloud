package handler

import (
	"context"
	"net/http"

	"github.com/a-h/templ"

	"github.com/porr-ag/infra-webshop/src/internal/view"
)

// isHTMX reports whether the request was made by HTMX.
func isHTMX(r *http.Request) bool {
	return r.Header.Get("HX-Request") == "true"
}

// buildPageData assembles the common layout context for templ pages.
func (h *Handler) buildPageData(w http.ResponseWriter, r *http.Request) view.PageData {
	sess, _ := h.sessions.Get(r)
	flash := h.sessions.PopFlash(w, r)
	lang := h.lang(r)
	b := getBrandCache()

	return view.PageData{
		Session: sess,
		Flash:   flash,
		Path:    r.URL.Path,
		Lang:    lang,
		Brand: view.Brand{
			Name:           coalesce(b.ShopName, h.cfg.AppName),
			Subtitle:       coalesce(b.ShopSubtitle, h.cfg.AppSubtitle),
			PrimaryColor:   b.PrimaryColor,
			SecondaryColor: b.SecondaryColor,
			HasLogo:        len(b.LogoData) > 0,
			ImprintText:    b.ImprintText,
		},
		SearchQuery: r.URL.Query().Get("q"),
	}.WithSupportedLangs()
}

// renderTempl writes a full-page templ component to the response.
func renderTempl(w http.ResponseWriter, r *http.Request, c templ.Component) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := c.Render(r.Context(), w); err != nil {
		http.Error(w, "render error", http.StatusInternalServerError)
	}
}

// renderPartials writes multiple templ components sequentially into one response.
// Use this for HTMX partial responses that include OOB swaps.
func renderPartials(ctx context.Context, w http.ResponseWriter, components ...templ.Component) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	for _, c := range components {
		_ = c.Render(ctx, w)
	}
}
