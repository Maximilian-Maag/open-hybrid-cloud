package handler

import (
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/src/internal/auth"
	"github.com/porr-ag/infra-webshop/src/internal/i18n"
	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/view"
	projectpages "github.com/porr-ag/infra-webshop/src/ui/pages/projects"
)

func (h *Handler) projectList(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.FromContext(r.Context())
	var projects []model.Project
	var err error
	if sess.Role == model.RoleProjectLeader {
		projects, err = h.projects.ListByOwner(r.Context(), sess.UserID)
	} else {
		projects, err = h.projects.ListAll(r.Context())
	}
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	costCenters, _ := h.costCenters.FindAll(r.Context())
	renderTempl(w, r, projectpages.ProjectList(view.ProjectListView{
		PageData:    h.buildPageData(w, r),
		Projects:    projects,
		CostCenters: costCenters,
	}))
}

func (h *Handler) projectNew(w http.ResponseWriter, r *http.Request) {
	costCenters, _ := h.costCenters.FindAll(r.Context())
	renderTempl(w, r, projectpages.ProjectNew(view.ProjectNewView{
		PageData:    h.buildPageData(w, r),
		CostCenters: costCenters,
	}))
}

func (h *Handler) projectCreate(w http.ResponseWriter, r *http.Request) {
	lang := h.lang(r)
	sess, _ := auth.FromContext(r.Context())
	ccID, _ := strconv.ParseInt(r.FormValue("cost_center_id"), 10, 64)
	p := &model.Project{
		Name:         r.FormValue("name"),
		Description:  r.FormValue("description"),
		OwnerID:      sess.UserID,
		CostCenterID: ccID,
	}
	if err := h.projects.Create(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/projects/new", "error", i18n.T("flash.project_create_error", lang))
		return
	}
	h.redirectWithFlash(w, r, "/projects", "success", i18n.T("flash.project_created", lang))
}

func (h *Handler) projectDetail(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	p, err := h.projects.GetByID(r.Context(), id)
	if err != nil || p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sess.Role == model.RoleProjectLeader && p.OwnerID != sess.UserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	costCenters, _ := h.costCenters.FindAll(r.Context())
	renderTempl(w, r, projectpages.ProjectDetail(view.ProjectDetailView{
		PageData:    h.buildPageData(w, r),
		Project:     p,
		CostCenters: costCenters,
	}))
}

func (h *Handler) projectUpdate(w http.ResponseWriter, r *http.Request) {
	lang := h.lang(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	p, _ := h.projects.GetByID(r.Context(), id)
	if p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sess.Role == model.RoleProjectLeader && p.OwnerID != sess.UserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ccID, _ := strconv.ParseInt(r.FormValue("cost_center_id"), 10, 64)
	p.Name = r.FormValue("name")
	p.Description = r.FormValue("description")
	p.CostCenterID = ccID
	if err := h.projects.Update(r.Context(), p); err != nil {
		h.redirectWithFlash(w, r, "/projects/"+strconv.FormatInt(id, 10), "error", i18n.T("flash.save_error", lang))
		return
	}
	h.redirectWithFlash(w, r, "/projects", "success", i18n.T("flash.project_saved", lang))
}

func (h *Handler) projectDelete(w http.ResponseWriter, r *http.Request) {
	lang := h.lang(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	p, _ := h.projects.GetByID(r.Context(), id)
	if p == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sess.Role == model.RoleProjectLeader && p.OwnerID != sess.UserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := h.infra.DecommissionByProject(r.Context(), id, sess.UserID); err != nil {
		h.redirectWithFlash(w, r, "/projects", "error", i18n.T("flash.decommission_error", lang)+": "+err.Error())
		return
	}
	if err := h.projects.Delete(r.Context(), id); err != nil {
		h.redirectWithFlash(w, r, "/projects", "error", i18n.T("flash.error", lang)+": "+err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/projects", "success", i18n.T("flash.project_deleted", lang))
}
