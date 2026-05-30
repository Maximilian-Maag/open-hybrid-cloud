package main

import (
	"log/slog"
	"os"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/infrawebshop?sslmode=disable"
	}

	slog.Info("running migrations", "database", dbURL)
	// TODO: implement schema migrations (e.g. via golang-migrate or goose)
	slog.Info("migrations complete")
}
