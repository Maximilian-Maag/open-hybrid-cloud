package app

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/aitranslation"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/audit"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/auth"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/exchange"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/handler"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/notification"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/polling"
	pgRepo "github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository/postgres"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service/impl"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/ui"
)

// New wires all application dependencies and returns an http.Handler.
// The ctx controls background workers (polling); cancel it to stop them.
func New(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool) (http.Handler, error) {
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

	// Background polling worker
	pollingWorker := polling.NewWorker(orderRepo, infraRepo, envRepo, sourceRepo, userRepo, productWebhookRepo, notifier, pool)
	go pollingWorker.Run(ctx)

	// Bootstrap admin user on first start
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

	// HTTP handler
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

	return mux, nil
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
