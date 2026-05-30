package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type exchangeRateRepo struct{ pool *pgxpool.Pool }

func NewExchangeRateRepository(pool *pgxpool.Pool) repository.ExchangeRateRepository {
	return &exchangeRateRepo{pool}
}

func (r *exchangeRateRepo) LoadAll(ctx context.Context) (map[string]float64, error) {
	rows, err := r.pool.Query(ctx, `SELECT currency_code, rate FROM exchange_rates`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var code string
		var rate float64
		if err := rows.Scan(&code, &rate); err != nil {
			return nil, err
		}
		out[code] = rate
	}
	return out, rows.Err()
}

func (r *exchangeRateRepo) SaveAll(ctx context.Context, rates map[string]float64) error {
	now := time.Now()
	for code, rate := range rates {
		_, err := r.pool.Exec(ctx,
			`INSERT INTO exchange_rates (currency_code, rate, updated_at) VALUES ($1, $2, $3)
			 ON CONFLICT (currency_code) DO UPDATE SET rate = EXCLUDED.rate, updated_at = EXCLUDED.updated_at`,
			code, rate, now)
		if err != nil {
			return err
		}
	}
	return nil
}
