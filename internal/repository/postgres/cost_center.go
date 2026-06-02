package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type costCenterRepo struct{ pool *pgxpool.Pool }

func NewCostCenterRepository(pool *pgxpool.Pool) repository.CostCenterRepository {
	return &costCenterRepo{pool}
}

func (r *costCenterRepo) FindAll(ctx context.Context) ([]model.CostCenter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,code,name,active FROM cost_centers ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanCostCenter)
}

func (r *costCenterRepo) FindByID(ctx context.Context, id int64) (*model.CostCenter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,code,name,active FROM cost_centers WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	cc, err := pgx.CollectExactlyOneRow(rows, scanCostCenter)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &cc, err
}

func (r *costCenterRepo) Save(ctx context.Context, cc *model.CostCenter) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO cost_centers(code,name,active) VALUES($1,$2,$3) RETURNING id`,
		cc.Code, cc.Name, cc.Active,
	).Scan(&cc.ID)
}

func (r *costCenterRepo) Update(ctx context.Context, cc *model.CostCenter) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE cost_centers SET code=$1,name=$2,active=$3 WHERE id=$4`,
		cc.Code, cc.Name, cc.Active, cc.ID)
	return err
}

func scanCostCenter(row pgx.CollectableRow) (model.CostCenter, error) {
	var cc model.CostCenter
	return cc, row.Scan(&cc.ID, &cc.Code, &cc.Name, &cc.Active)
}
