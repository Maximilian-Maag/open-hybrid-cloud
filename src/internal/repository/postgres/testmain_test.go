package postgres

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
)

var testPool *pgxpool.Pool

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
		fmt.Fprintf(os.Stderr, "postgres container unavailable, skipping integration tests: %v\n", err)
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

	os.Exit(m.Run())
}

// resetDB truncates all data tables and restarts sequences.
// Call at the start of every test that writes data.
func resetDB(t *testing.T) {
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
		"users",
		"cost_centers",
		"exchange_rates",
	}, ",")
	_, err := testPool.Exec(context.Background(),
		"TRUNCATE "+tables+" RESTART IDENTITY CASCADE")
	if err != nil {
		t.Fatalf("resetDB: %v", err)
	}
}
