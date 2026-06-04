package handler

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/view"
	homepages "github.com/porr-ag/infra-webshop/src/ui/pages/home"
)

func (h *Handler) home(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sess, _ := h.sessions.Get(r)

	var stats view.HomeStats
	if sess != nil {
		if orders, err := h.orders.ListByUser(ctx, sess.UserID); err == nil {
			stats.TotalOrders = len(orders)
		}
		if projects, err := h.projects.ListByOwner(ctx, sess.UserID); err == nil {
			stats.Projects = len(projects)
			for _, p := range projects {
				if elems, err := h.infra.ListByProject(ctx, p.ID); err == nil {
					stats.InfraCount += len(elems)
				}
			}
		}
		if sess.Role == model.RoleAdmin || sess.Role == model.RoleShopAdmin {
			if pending, err := h.orders.ListPendingApproval(ctx); err == nil {
				stats.PendingOrders = len(pending)
			}
		}
	}

	lang := h.lang(r)
	prods, _ := h.products.ListAll(ctx, lang)
	var featured []view.ProductCardView
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
		featured = append(featured, v)
		if len(featured) >= 6 {
			break
		}
	}

	renderTempl(w, r, homepages.Home(view.HomeView{
		PageData: h.buildPageData(w, r),
		Stats:    stats,
		Featured: featured,
	}))
}
