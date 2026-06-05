package e2e_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	playwright "github.com/playwright-community/playwright-go"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/app"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
)

const (
	adminEmail    = "admin@e2etest.local"
	adminPassword = "e2eAdmin123!"
	sessionSecret = "e2e-test-secret-32-chars-paddddd"
)

var (
	baseURL        string
	webhookBaseURL string // mock GitLab pipeline trigger server
	pw             *playwright.Playwright
	browser        playwright.Browser
	testDB         *pgxpool.Pool
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	// Mock GitLab webhook server — returns a pipeline ID so Approve() succeeds.
	webhookSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"id":42}`)
	}))
	defer webhookSrv.Close()
	webhookBaseURL = webhookSrv.URL

	ctr, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("e2etestdb"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres container unavailable, skipping e2e tests: %v\n", err)
		os.Exit(0)
	}
	defer ctr.Terminate(ctx) //nolint:errcheck

	connStr, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		os.Exit(1)
	}

	testDB, err = pgxpool.New(ctx, connStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "pgxpool: %v\n", err)
		os.Exit(1)
	}
	defer testDB.Close()

	if err := migrations.Run(ctx, testDB); err != nil {
		fmt.Fprintf(os.Stderr, "migrations: %v\n", err)
		os.Exit(1)
	}

	workerCtx, cancelWorker := context.WithCancel(ctx)
	defer cancelWorker()

	cfg := &config.Config{
		Port:          "0",
		AppName:       "E2E Test",
		AppSubtitle:   "E2E Test Suite",
		DatabaseURL:   connStr,
		SessionSecret: sessionSecret,
		AdminEmail:    adminEmail,
		AdminPassword: adminPassword,
		SMTPHost:      "localhost",
		SMTPPort:      "1025",
		SMTPFrom:      "noreply@e2etest.local",
		BaseCurrency:  "EUR",
		AIProvider:    "claude",
		AIModel:       "claude-haiku-4-5-20251001",
	}

	h, err := app.New(workerCtx, cfg, testDB)
	if err != nil {
		fmt.Fprintf(os.Stderr, "app.New: %v\n", err)
		os.Exit(1)
	}

	srv := httptest.NewServer(h)
	defer srv.Close()
	baseURL = srv.URL

	if err := playwright.Install(&playwright.RunOptions{Browsers: []string{"chromium"}}); err != nil {
		fmt.Fprintf(os.Stderr, "playwright install: %v\n", err)
		os.Exit(1)
	}

	pw, err = playwright.Run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "playwright run: %v\n", err)
		os.Exit(1)
	}
	defer pw.Stop() //nolint:errcheck

	headless := os.Getenv("E2E_HEADED") != "true"
	browser, err = pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(headless),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "browser launch: %v\n", err)
		os.Exit(1)
	}
	defer browser.Close()

	os.Exit(m.Run())
}
