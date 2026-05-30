package handler

import (
	"html/template"
	"net/http"

	"github.com/porr-ag/infra-webshop/internal/config"
)

type Handler struct {
	cfg  *config.Config
	tmpl *template.Template
}

func New(cfg *config.Config, tmpl *template.Template) *Handler {
	return &Handler{cfg: cfg, tmpl: tmpl}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /{$}", h.home)
}
