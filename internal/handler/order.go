package handler

import (
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/model"
)

func (h *Handler) orderList(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.FromContext(r.Context())
	orders, err := h.orders.ListByUser(r.Context(), sess.UserID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	h.render(w, r, "orders.html", map[string]any{"Orders": orders})
}

func (h *Handler) orderNew(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.FromContext(r.Context())
	productID, _ := strconv.ParseInt(r.URL.Query().Get("product"), 10, 64)
	envID, _ := strconv.ParseInt(r.URL.Query().Get("env"), 10, 64)

	// FA-06.7: pre-fill from an existing infra element
	prefilledParams := map[string]string{}
	if fromInfraID, _ := strconv.ParseInt(r.URL.Query().Get("from_infra"), 10, 64); fromInfraID > 0 {
		if el, err := h.infra.GetByID(r.Context(), fromInfraID); err == nil && el != nil {
			productID = el.ProductID
			envID = el.EnvironmentID
			prefilledParams = el.Parameters
		}
	}

	var projects interface{}
	if sess.Role == model.RoleAdmin || sess.Role == model.RoleShopAdmin {
		projects, _ = h.projects.ListAll(r.Context())
	} else {
		projects, _ = h.projects.ListByOwner(r.Context(), sess.UserID)
	}

	params, _ := h.parameters.FindByScope(r.Context(), "product", productID)
	globalParams, _ := h.parameters.FindByScope(r.Context(), "global", 0)

	product, _ := h.products.GetByID(r.Context(), productID, h.lang(r))
	env, _ := h.environments.FindByID(r.Context(), envID)
	costCenters, _ := h.costCenters.FindAll(r.Context())

	h.render(w, r, "order-new.html", map[string]any{
		"Product":         product,
		"Environment":     env,
		"Projects":        projects,
		"Parameters":      append(globalParams, params...),
		"CostCenters":     costCenters,
		"PrefilledParams": prefilledParams,
	})
}

func (h *Handler) orderCreate(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.FromContext(r.Context())
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	productID, _ := strconv.ParseInt(r.FormValue("product_id"), 10, 64)
	envID, _ := strconv.ParseInt(r.FormValue("environment_id"), 10, 64)
	projectID, _ := strconv.ParseInt(r.FormValue("project_id"), 10, 64)
	ccID, _ := strconv.ParseInt(r.FormValue("cost_center_id"), 10, 64)

	// Collect all form values not handled above as parameters
	params := map[string]string{}
	reserved := map[string]bool{
		"product_id": true, "environment_id": true,
		"project_id": true, "cost_center_id": true,
	}
	for k, vs := range r.Form {
		if !reserved[k] && len(vs) > 0 {
			params[k] = vs[0]
		}
	}

	o := &model.Order{
		ProductID:     productID,
		EnvironmentID: envID,
		ProjectID:     projectID,
		UserID:        sess.UserID,
		CostCenterID:  ccID,
		Parameters:    params,
	}

	// Admins and Shop Admins skip approval and go straight to provisioning
	if sess.Role == model.RoleAdmin || sess.Role == model.RoleShopAdmin {
		o.Status = model.OrderStatusPendingApproval
		if err := h.orders.Create(r.Context(), o); err != nil {
			h.redirectWithFlash(w, r, "/orders/new", "error", "Bestellung konnte nicht erstellt werden.")
			return
		}
		if err := h.orders.Approve(r.Context(), o.ID, sess.UserID); err != nil {
			h.redirectWithFlash(w, r, "/orders", "error", "Webhook konnte nicht ausgelöst werden: "+err.Error())
			return
		}
		if h.notifier != nil {
			_ = h.notifier.OrderCreated(r.Context(), o, sess.Email, false)
		}
	} else {
		if err := h.orders.Create(r.Context(), o); err != nil {
			h.redirectWithFlash(w, r, "/orders/new", "error", "Bestellung konnte nicht erstellt werden.")
			return
		}
		if h.notifier != nil {
			_ = h.notifier.OrderCreated(r.Context(), o, sess.Email, true)
		}
	}
	h.redirectWithFlash(w, r, "/orders", "success", "Bestellung erfolgreich aufgegeben.")
}

func (h *Handler) orderDetail(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	o, err := h.orders.GetByID(r.Context(), id)
	if err != nil || o == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sess.Role == model.RoleProjectLeader && o.UserID != sess.UserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	product, _ := h.products.GetByID(r.Context(), o.ProductID, h.lang(r))
	env, _ := h.environments.FindByID(r.Context(), o.EnvironmentID)
	project, _ := h.projects.GetByID(r.Context(), o.ProjectID)
	infra, _ := h.infra.FindByOrderID(r.Context(), o.ID)
	h.render(w, r, "order-detail.html", map[string]any{
		"Order":   o,
		"Product": product,
		"Env":     env,
		"Project": project,
		"Infra":   infra,
	})
}

func (h *Handler) approvalList(w http.ResponseWriter, r *http.Request) {
	orders, err := h.orders.ListPendingApproval(r.Context())
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	h.render(w, r, "approvals.html", map[string]any{"Orders": orders})
}

func (h *Handler) approvalApprove(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	if err := h.orders.Approve(r.Context(), id, sess.UserID); err != nil {
		h.redirectWithFlash(w, r, "/approvals", "error", err.Error())
		return
	}
	if h.notifier != nil {
		if o, err := h.orders.GetByID(r.Context(), id); err == nil && o != nil {
			if u, err := h.users.GetByID(r.Context(), o.UserID); err == nil && u != nil {
				_ = h.notifier.OrderApproved(r.Context(), o, u.Email)
			}
		}
	}
	h.redirectWithFlash(w, r, "/approvals", "success", "Bestellung freigegeben.")
}

func (h *Handler) approvalReject(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	note := r.FormValue("note")
	if note == "" {
		h.redirectWithFlash(w, r, "/approvals", "error", "Ablehnungskommentar ist verpflichtend.")
		return
	}
	sess, _ := auth.FromContext(r.Context())
	if err := h.orders.Reject(r.Context(), id, sess.UserID, note); err != nil {
		h.redirectWithFlash(w, r, "/approvals", "error", err.Error())
		return
	}
	if h.notifier != nil {
		if o, err := h.orders.GetByID(r.Context(), id); err == nil && o != nil {
			if u, err := h.users.GetByID(r.Context(), o.UserID); err == nil && u != nil {
				_ = h.notifier.OrderRejected(r.Context(), o, u.Email, note)
			}
		}
	}
	h.redirectWithFlash(w, r, "/approvals", "success", "Bestellung abgelehnt.")
}
