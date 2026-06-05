package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/db"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/migrations"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/infrawebshop?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := db.New(ctx, dbURL)
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := migrations.Run(ctx, pool); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}
	slog.Info("migrations complete")
}
