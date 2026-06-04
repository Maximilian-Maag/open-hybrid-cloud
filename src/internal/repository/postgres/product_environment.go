package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/repository"
)

type productEnvRepo struct{ pool *pgxpool.Pool }

func NewProductEnvironmentRepository(pool *pgxpool.Pool) repository.ProductEnvironmentRepository {
	return &productEnvRepo{pool}
}

const peCols = `product_id,environment_id,price,currency,cost_center_mode,forced_cost_center`

func (r *productEnvRepo) FindByProductID(ctx context.Context, productID int64) ([]model.ProductEnvironment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+peCols+` FROM product_environments WHERE product_id=$1`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanProductEnv)
}

func (r *productEnvRepo) FindByProductAndEnv(ctx context.Context, productID, envID int64) (*model.ProductEnvironment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+peCols+` FROM product_environments WHERE product_id=$1 AND environment_id=$2`,
		productID, envID)
	if err != nil {
		return nil, err
	}
	pe, err := pgx.CollectExactlyOneRow(rows, scanProductEnv)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &pe, err
}

func (r *productEnvRepo) Upsert(ctx context.Context, pe *model.ProductEnvironment) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO product_environments(product_id,environment_id,price,currency,cost_center_mode,forced_cost_center)
		 VALUES($1,$2,$3,$4,$5,$6)
		 ON CONFLICT(product_id,environment_id) DO UPDATE
		 SET price=EXCLUDED.price,currency=EXCLUDED.currency,
		     cost_center_mode=EXCLUDED.cost_center_mode,forced_cost_center=EXCLUDED.forced_cost_center`,
		pe.ProductID, pe.EnvironmentID, pe.Price, pe.Currency,
		string(pe.CostCenterMode), pe.ForcedCostCenter)
	return err
}

func (r *productEnvRepo) Delete(ctx context.Context, productID, envID int64) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM product_environments WHERE product_id=$1 AND environment_id=$2`, productID, envID)
	return err
}

func scanProductEnv(row pgx.CollectableRow) (model.ProductEnvironment, error) {
	var pe model.ProductEnvironment
	return pe, row.Scan(&pe.ProductID, &pe.EnvironmentID, &pe.Price, &pe.Currency,
		&pe.CostCenterMode, &pe.ForcedCostCenter)
}
