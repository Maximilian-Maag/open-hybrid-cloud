package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/porr-ag/infra-webshop/src/internal/view"
	catalogpages "github.com/porr-ag/infra-webshop/src/ui/pages/catalog"
)

func (h *Handler) catalog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cats, err := h.categories.FindAll(ctx)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	lang := h.lang(r)
	prods, err := h.products.ListAll(ctx, lang)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	// Search filter
	query := r.URL.Query().Get("q")
	if query != "" {
		filtered := prods[:0]
		ql := strings.ToLower(query)
		for _, p := range prods {
			if strings.Contains(strings.ToLower(p.Name), ql) || strings.Contains(strings.ToLower(p.Description), ql) {
				filtered = append(filtered, p)
			}
		}
		prods = filtered
	}

	// Category filter
	var selectedCat int64
	if catStr := r.URL.Query().Get("cat"); catStr != "" {
		selectedCat, _ = strconv.ParseInt(catStr, 10, 64)
		if selectedCat > 0 {
			filtered := prods[:0]
			for _, p := range prods {
				if p.CategoryID == selectedCat {
					filtered = append(filtered, p)
				}
			}
			prods = filtered
		}
	}

	views := make([]view.ProductCardView, 0, len(prods))
	for _, p := range prods {
		cat, _ := h.categories.FindByID(ctx, p.CategoryID)
		envs, _ := h.productEnvs.FindByProductID(ctx, p.ID)
		v := view.ProductCardView{Product: p, EnvCount: len(envs)}
		if cat != nil {
			v.CategoryName = cat.Name
		}
		for _, pe := range envs {
			if v.Currency == "" || pe.Price < v.MinPrice {
				v.MinPrice = pe.Price
				v.Currency = pe.Currency
			}
		}
		views = append(views, v)
	}

	renderTempl(w, r, catalogpages.Catalog(view.CatalogView{
		PageData:    h.buildPageData(w, r),
		Categories:  cats,
		Products:    views,
		Query:       query,
		SelectedCat: selectedCat,
	}))
}

func (h *Handler) catalogProduct(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	lang := h.lang(r)
	p, err := h.products.GetByID(r.Context(), id, lang)
	if err != nil || p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	envs, err := h.productEnvs.FindByProductID(r.Context(), id)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	var entries []view.CatalogEnvEntry
	for _, pe := range envs {
		env, _ := h.environments.FindByID(r.Context(), pe.EnvironmentID)
		if env != nil {
			entries = append(entries, view.CatalogEnvEntry{
				ID: env.ID, Name: env.Name,
				Price: pe.Price, Currency: pe.Currency,
			})
		}
	}
	params, _ := h.parameters.FindByScope(r.Context(), "product", id)

	var catName string
	if p.CategoryID > 0 {
		cat, _ := h.categories.FindByID(r.Context(), p.CategoryID)
		if cat != nil {
			catName = cat.Name
		}
	}

	renderTempl(w, r, catalogpages.CatalogProduct(view.CatalogProductView{
		PageData:     h.buildPageData(w, r),
		Product:      p,
		Environments: entries,
		Parameters:   params,
		CategoryName: catName,
	}))
}
