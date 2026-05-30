package handler

import (
	"net/http"
	"strconv"
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

	views := make([]ProductCardView, 0, len(prods))
	for _, p := range prods {
		cat, _ := h.categories.FindByID(ctx, p.CategoryID)
		envs, _ := h.productEnvs.FindByProductID(ctx, p.ID)
		v := ProductCardView{Product: p, EnvCount: len(envs)}
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

	h.render(w, r, "catalog.html", map[string]any{
		"Categories": cats,
		"Products":   views,
	})
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
	type envEntry struct {
		ID       int64
		Name     string
		Price    float64
		Currency string
	}
	var entries []envEntry
	for _, pe := range envs {
		env, _ := h.environments.FindByID(r.Context(), pe.EnvironmentID)
		if env != nil {
			entries = append(entries, envEntry{
				ID: env.ID, Name: env.Name,
				Price: pe.Price, Currency: pe.Currency,
			})
		}
	}
	params, _ := h.parameters.FindByScope(r.Context(), "product", id)
	h.render(w, r, "catalog-product.html", map[string]any{
		"Product":      p,
		"Environments": entries,
		"Parameters":   params,
	})
}

