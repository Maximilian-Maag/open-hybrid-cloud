package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/internal/gitlab"
	"github.com/porr-ag/infra-webshop/internal/model"
)

func (h *Handler) gitlabClientFromSource(r *http.Request) (*gitlab.Client, error) {
	_ = r.ParseForm()
	sourceValue := r.URL.Query().Get("source")
	if sourceValue == "" {
		sourceValue = r.FormValue("source")
	}
	sourceID, _ := strconv.ParseInt(sourceValue, 10, 64)
	src, err := h.gitlabSources.FindByID(r.Context(), sourceID)
	if err != nil || src == nil {
		return nil, http.ErrNoCookie // sentinel
	}
	return gitlab.NewClient(src.URL, src.AccessToken), nil
}

// gitlabProjects returns a JSON list of GitLab projects for the given source.
func (h *Handler) gitlabProjects(w http.ResponseWriter, r *http.Request) {
	client, err := h.gitlabClientFromSource(r)
	if err != nil {
		http.Error(w, "source not found", http.StatusBadRequest)
		return
	}
	projects, err := client.ListProjects(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(projects)
}

// gitlabBranches returns a JSON list of branches for a project.
func (h *Handler) gitlabBranches(w http.ResponseWriter, r *http.Request) {
	client, err := h.gitlabClientFromSource(r)
	if err != nil {
		http.Error(w, "source not found", http.StatusBadRequest)
		return
	}
	projectID, _ := strconv.ParseInt(r.URL.Query().Get("project"), 10, 64)
	branches, err := client.ListBranches(r.Context(), projectID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(branches)
}

// gitlabFiles returns a JSON file tree for a path in the repo.
func (h *Handler) gitlabFiles(w http.ResponseWriter, r *http.Request) {
	client, err := h.gitlabClientFromSource(r)
	if err != nil {
		http.Error(w, "source not found", http.StatusBadRequest)
		return
	}
	q := r.URL.Query()
	projectID, _ := strconv.ParseInt(q.Get("project"), 10, 64)
	files, err := client.ListFiles(r.Context(), projectID, q.Get("branch"), q.Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(files)
}

// gitlabImportVars reads a Terraform variables.tf file and imports its variables
// as product parameters. Expects form fields: source, project, branch, file, product_id.
func (h *Handler) gitlabImportVars(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	client, err := h.gitlabClientFromSource(r)
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/new", "error", "GitLab source not found.")
		return
	}
	projectID, _ := strconv.ParseInt(r.FormValue("project"), 10, 64)
	branch := r.FormValue("branch")
	filePath := r.FormValue("file")
	productID, _ := strconv.ParseInt(r.FormValue("product_id"), 10, 64)
	if productID <= 0 {
		h.redirectWithFlash(w, r, "/admin/products/new", "error", "Please save the product before importing variables.")
		return
	}

	content, err := client.GetFile(r.Context(), projectID, branch, filePath)
	if err != nil {
		h.redirectWithFlash(w, r, "/admin/products/new", "error", "Could not read file: "+err.Error())
		return
	}

	vars := gitlab.ParseVariables(content)
	for _, v := range vars {
		paramType := model.ParameterTypeString
		switch v.Type {
		case "number":
			paramType = model.ParameterTypeNumber
		case "bool":
			paramType = model.ParameterTypeBool
		}
		name := v.Name
		p := &model.Parameter{
			Scope:        model.ParameterScopeProduct,
			ScopeID:      productID,
			Name:         name,
			Type:         paramType,
			Description:  v.Description,
			DefaultValue: v.DefaultValue,
			Required:     v.DefaultValue == "",
			Sensitive:    v.Sensitive,
		}
		_ = h.parameters.Save(r.Context(), p)
	}

	target := "/admin/products/new"
	if productID > 0 {
		target = "/admin/products/" + strconv.FormatInt(productID, 10)
	}
	h.redirectWithFlash(w, r, target, "success",
		strconv.Itoa(len(vars))+" variables imported.")
}
