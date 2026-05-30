package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/audit"
	"github.com/porr-ag/infra-webshop/internal/config"
	"github.com/porr-ag/infra-webshop/internal/db"
	"github.com/porr-ag/infra-webshop/internal/handler"
	"github.com/porr-ag/infra-webshop/internal/migrations"
	"github.com/porr-ag/infra-webshop/internal/model"
	pgRepo "github.com/porr-ag/infra-webshop/internal/repository/postgres"
	"github.com/porr-ag/infra-webshop/internal/service/impl"
	"github.com/porr-ag/infra-webshop/ui"
	"io/fs"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	// Database
	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Migrations
	if err := migrations.Run(ctx, pool); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}

	// Repositories
	userRepo := pgRepo.NewUserRepository(pool)
	categoryRepo := pgRepo.NewCategoryRepository(pool)
	productRepo := pgRepo.NewProductRepository(pool)
	translationRepo := pgRepo.NewProductTranslationRepository(pool)
	paramRepo := pgRepo.NewParameterRepository(pool)
	sourceRepo := pgRepo.NewGitLabSourceRepository(pool)
	envRepo := pgRepo.NewEnvironmentRepository(pool)
	productEnvRepo := pgRepo.NewProductEnvironmentRepository(pool)
	ccRepo := pgRepo.NewCostCenterRepository(pool)
	projectRepo := pgRepo.NewProjectRepository(pool)
	orderRepo := pgRepo.NewOrderRepository(pool)
	infraRepo := pgRepo.NewInfrastructureRepository(pool)
	auditRepo := pgRepo.NewAuditRepository(pool)

	// Services
	auditSvc := audit.NewService(auditRepo)
	userSvc := impl.NewUserService(userRepo)
	productSvc := impl.NewProductService(productRepo, translationRepo)
	orderSvc := impl.NewOrderService(orderRepo, infraRepo, envRepo, auditSvc)
	projectSvc := impl.NewProjectService(projectRepo)
	infraSvc := impl.NewInfrastructureService(infraRepo, envRepo, auditSvc)

	// Bootstrap admin user
	bootstrapAdmin(ctx, userSvc, cfg)

	// Auth
	sessions := auth.NewSessionStore(cfg.SessionSecret)
	oidc, err := auth.NewOIDCProvider(ctx, auth.OIDCConfig{
		TenantID:     cfg.EntraTenantID,
		ClientID:     cfg.EntraClientID,
		ClientSecret: cfg.EntraClientSecret,
		RedirectURL:  cfg.EntraRedirectURL,
	})
	if err != nil {
		slog.Warn("OIDC init failed, SSO disabled", "err", err)
	}

	// Handler
	h := handler.New(handler.Deps{
		Cfg:           cfg,
		Sessions:      sessions,
		OIDC:          oidc,
		Users:         userSvc,
		Products:      productSvc,
		Orders:        orderSvc,
		Projects:      projectSvc,
		Infra:         infraSvc,
		Audit:         auditSvc,
		Categories:    categoryRepo,
		Environments:  envRepo,
		CostCenters:   ccRepo,
		GitLabSources: sourceRepo,
		Parameters:    paramRepo,
		ProductEnvs:   productEnvRepo,
		Translations:  translationRepo,
	})

	staticFS, _ := fs.Sub(ui.Static, "static")

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("starting server", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down...")
	shutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

func bootstrapAdmin(ctx context.Context, users interface {
	GetByEmail(context.Context, string) (*model.User, error)
	Create(context.Context, *model.User, string) error
}, cfg *config.Config) {
	existing, err := users.GetByEmail(ctx, cfg.AdminEmail)
	if err != nil || existing != nil {
		return
	}
	u := &model.User{
		Email: cfg.AdminEmail,
		Name:  "Webshop Admin",
		Role:  model.RoleShopAdmin,
	}
	if err := users.Create(ctx, u, cfg.AdminPassword); err != nil {
		slog.Error("bootstrap admin failed", "err", err)
	} else {
		slog.Info("admin user created", "email", cfg.AdminEmail)
	}
}
