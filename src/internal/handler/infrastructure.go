package handler

import (
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/src/internal/auth"
	"github.com/porr-ag/infra-webshop/src/internal/i18n"
	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/view"
	infrapages "github.com/porr-ag/infra-webshop/src/ui/pages/infra"
)

func (h *Handler) infrastructureList(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.FromContext(r.Context())
	var elements []model.InfrastructureElement
	var err error
	if sess.Role == model.RoleProjectLeader {
		projs, _ := h.projects.ListByOwner(r.Context(), sess.UserID)
		for _, p := range projs {
			els, e := h.infra.ListByProject(r.Context(), p.ID)
			if e != nil {
				err = e
				break
			}
			elements = append(elements, els...)
		}
	} else {
		elements, err = h.infra.ListAll(r.Context())
	}
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	renderTempl(w, r, infrapages.Infrastructure(view.InfraView{
		PageData: h.buildPageData(w, r),
		Elements: elements,
	}))
}

func (h *Handler) decommission(w http.ResponseWriter, r *http.Request) {
	lang := h.lang(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	sess, _ := auth.FromContext(r.Context())
	el, _ := h.infra.GetByID(r.Context(), id)
	if el == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sess.Role == model.RoleProjectLeader {
		proj, _ := h.projects.GetByID(r.Context(), el.ProjectID)
		if proj == nil || proj.OwnerID != sess.UserID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	if err := h.infra.Decommission(r.Context(), id, sess.UserID); err != nil {
		h.redirectWithFlash(w, r, "/infrastructure", "error", err.Error())
		return
	}
	h.redirectWithFlash(w, r, "/infrastructure", "success", i18n.T("flash.decommission_started", lang))
}
