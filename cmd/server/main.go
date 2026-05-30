package main

import (
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/porr-ag/infra-webshop/internal/config"
	"github.com/porr-ag/infra-webshop/internal/handler"
	"github.com/porr-ag/infra-webshop/ui"
)

func main() {
	cfg := config.Load()

	tmpl := mustParseTemplates()

	staticFS, err := fs.Sub(ui.Static, "static")
	if err != nil {
		slog.Error("static fs error", "err", err)
		os.Exit(1)
	}

	h := handler.New(cfg, tmpl)

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	slog.Info("starting server", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

// mustParseTemplates walks the embedded templates FS and parses all .html files.
// Each template is named by its base filename (e.g. "index.html").
// Multi-page layouts that need isolated block scopes should clone this template
// set per route using tmpl.Lookup("layout").Clone().
func mustParseTemplates() *template.Template {
	tmpl := template.New("")
	err := fs.WalkDir(ui.Templates, "templates", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".html") {
			return err
		}
		content, err := fs.ReadFile(ui.Templates, p)
		if err != nil {
			return err
		}
		_, err = tmpl.New(path.Base(p)).Parse(string(content))
		return err
	})
	if err != nil {
		slog.Error("template parse error", "err", err)
		os.Exit(1)
	}
	return tmpl
}
