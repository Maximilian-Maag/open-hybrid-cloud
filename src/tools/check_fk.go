package tools

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func CheckFK() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/openhybridcloud?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("connect failed: %w", err)
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `
        SELECT t.relname AS table, c.conname AS constraint, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname IN ('orders','infrastructure_elements') AND c.contype='f'
    `)
	if err != nil {
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var table, conname, def string
	for rows.Next() {
		if err := rows.Scan(&table, &conname, &def); err != nil {
			return fmt.Errorf("scan failed: %w", err)
		}
		fmt.Printf("%s: %s -> %s\n", table, conname, def)
	}
	if rows.Err() != nil {
		return fmt.Errorf("rows error: %w", rows.Err())
	}
	return nil
}
