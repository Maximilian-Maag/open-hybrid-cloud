package handler_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/app"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/auth"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/config"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	pgRepo "github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository/postgres"
)

const (
	testRootEmail     = "root@test.local"
	testRootPassword  = "root-secret"
	testAdminEmail    = "admin@test.local"
	testAdminPassword = "admin-secret"
	testPLEmail       = "pl@test.local"
	testPLPassword    = "pl-secret"
	testSessionSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

var (
	testServer *httptest.Server
	testPool   *pgxpool.Pool
)

func TestMain(m *testing.M) {
	ctx := context.Background()

	ctr, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("testdb"),
		tcpostgres.WithUsername("test"),
		tcpostgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres container unavailable, skipping handler integration tests: %v\n", err)
		os.Exit(0)
	}
	defer ctr.Terminate(ctx) //nolint:errcheck

	connStr, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		os.Exit(1)
	}

	testPool, err = pgxpool.New(ctx, connStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "pgxpool: %v\n", err)
		os.Exit(1)
	}
	defer testPool.Close()

	if err := migrations.Run(ctx, testPool); err != nil {
		fmt.Fprintf(os.Stderr, "migrations: %v\n", err)
		os.Exit(1)
	}

	cfg := &config.Config{
		AppName:       "Test Shop",
		AppSubtitle:   "Test",
		SessionSecret: testSessionSecret,
		AdminEmail:    testRootEmail,
		AdminPassword: testRootPassword,
		SMTPHost:      "localhost",
		SMTPPort:      "1025",
		SMTPFrom:      "noreply@test.local",
		BaseCurrency:  "EUR",
		AIProvider:    "none",
	}

	appHandler, err := app.New(ctx, cfg, testPool)
	if err != nil {
		fmt.Fprintf(os.Stderr, "app.New: %v\n", err)
		os.Exit(1)
	}

	testServer = httptest.NewServer(appHandler)
	defer testServer.Close()

	// Seed additional test users (root is already bootstrapped by app.New)
	userRepo := pgRepo.NewUserRepository(testPool)
	if err := seedUser(ctx, userRepo, testAdminEmail, "Admin User", model.RoleAdmin, testAdminPassword); err != nil {
		fmt.Fprintf(os.Stderr, "seed admin user: %v\n", err)
		os.Exit(1)
	}
	if err := seedUser(ctx, userRepo, testPLEmail, "Project Leader", model.RoleProjectLeader, testPLPassword); err != nil {
		fmt.Fprintf(os.Stderr, "seed pl user: %v\n", err)
		os.Exit(1)
	}

	os.Exit(m.Run())
}

func seedUser(ctx context.Context, repo interface {
	Save(ctx context.Context, u *model.User) error
}, email, name string, role model.Role, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	return repo.Save(ctx, &model.User{
		Email:        email,
		Name:         name,
		Role:         role,
		PasswordHash: hash,
	})
}

// resetData truncates business-data tables between tests, leaving users intact.
func resetData(t *testing.T) {
	t.Helper()
	tables := strings.Join([]string{
		"audit_log",
		"infrastructure_elements",
		"orders",
		"projects",
		"product_webhooks",
		"product_environments",
		"product_translations",
		"products",
		"parameters",
		"deployment_environments",
		"gitlab_sources",
		"categories",
		"cost_centers",
		"exchange_rates",
	}, ",")
	if _, err := testPool.Exec(context.Background(), "TRUNCATE "+tables+" RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("resetData: %v", err)
	}
}
