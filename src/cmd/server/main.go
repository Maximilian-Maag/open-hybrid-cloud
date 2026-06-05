package main

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/aitranslation"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/audit"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/auth"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/db"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/exchange"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/handler"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/notification"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/polling"
	pgRepo "github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository/postgres"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service/impl"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/ui"
)

func main() {
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
	exchangeRatesRepo := pgRepo.NewExchangeRateRepository(pool)
	productWebhookRepo := pgRepo.NewProductWebhookRepository(pool)
	brandingRepo := pgRepo.NewBrandingRepository(pool)
	appConfigRepo := pgRepo.NewAppConfigRepository(pool)

	// Services
	auditSvc := audit.NewService(auditRepo)
	userSvc := impl.NewUserService(userRepo)
	productSvc := impl.NewProductService(productRepo, translationRepo)
	orderSvc := impl.NewOrderService(orderRepo, infraRepo, envRepo, sourceRepo, productWebhookRepo, auditSvc)
	projectSvc := impl.NewProjectService(projectRepo)
	infraSvc := impl.NewInfrastructureService(infraRepo, envRepo, productWebhookRepo, auditSvc)

	// Notification
	notifier := notification.NewService(cfg, userRepo)
	if appCfg, err := appConfigRepo.Load(ctx); err == nil && appCfg.SMTPHost != "" {
		notifier.Reconfigure(appCfg.SMTPHost, appCfg.SMTPPort, appCfg.SMTPFrom,
			appCfg.SMTPUsername, appCfg.SMTPPassword, appCfg.SMTPTLS)
	}

	// Exchange rates
	exchangeSvc := exchange.NewService(cfg.ExchangeRateAPIURL, cfg.ExchangeRateAPIKey)
	if rates, err := exchangeRatesRepo.LoadAll(ctx); err == nil {
		exchangeSvc.LoadRates(rates)
	}

	// AI translation — DB config overrides env vars if present
	aiProvider, aiEndpoint, aiAPIKey, aiModel := cfg.AIProvider, cfg.AIEndpoint, cfg.AIAPIKey, cfg.AIModel
	if appCfg, err := appConfigRepo.Load(ctx); err == nil && appCfg.AIProvider != "" {
		aiProvider, aiEndpoint, aiAPIKey, aiModel = appCfg.AIProvider, appCfg.AIEndpoint, appCfg.AIAPIKey, appCfg.AIModel
	}
	translator := aitranslation.NewTranslator(aiProvider, aiEndpoint, aiAPIKey, aiModel)

	// Polling worker
	pollingWorker := polling.NewWorker(orderRepo, infraRepo, envRepo, sourceRepo, userRepo, productWebhookRepo, notifier, pool)
	go pollingWorker.Run(ctx)

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
		Cfg:             cfg,
		Sessions:        sessions,
		OIDC:            oidc,
		Users:           userSvc,
		Products:        productSvc,
		Orders:          orderSvc,
		Projects:        projectSvc,
		Infra:           infraSvc,
		Audit:           auditSvc,
		Categories:      categoryRepo,
		Environments:    envRepo,
		CostCenters:     ccRepo,
		GitLabSources:   sourceRepo,
		Parameters:      paramRepo,
		ProductEnvs:     productEnvRepo,
		Translations:    translationRepo,
		ProductWebhooks: productWebhookRepo,
		Notifier:        notifier,
		Exchange:        exchangeSvc,
		ExchangeRates:   exchangeRatesRepo,
		Translator:      translator,
		BrandingRepo:    brandingRepo,
		AppConfigRepo:   appConfigRepo,
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

	<-ctx.Done()
	stop()

	slog.Info("shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
