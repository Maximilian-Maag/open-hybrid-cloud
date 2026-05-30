package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type infraRepo struct{ pool *pgxpool.Pool }

func NewInfrastructureRepository(pool *pgxpool.Pool) repository.InfrastructureRepository {
	return &infraRepo{pool}
}

const infraCols = `id,order_id,project_id,environment_id,product_id,status,parameters,deployed_at`

func (r *infraRepo) FindAll(ctx context.Context) ([]model.InfrastructureElement, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+infraCols+` FROM infrastructure_elements ORDER BY deployed_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanInfra)
}

func (r *infraRepo) FindByProjectID(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+infraCols+` FROM infrastructure_elements WHERE project_id=$1 ORDER BY deployed_at DESC`,
		projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanInfra)
}

func (r *infraRepo) FindByID(ctx context.Context, id int64) (*model.InfrastructureElement, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+infraCols+` FROM infrastructure_elements WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	el, err := pgx.CollectExactlyOneRow(rows, scanInfra)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &el, err
}

func (r *infraRepo) Save(ctx context.Context, el *model.InfrastructureElement) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO infrastructure_elements(order_id,project_id,environment_id,product_id,status,parameters)
		 VALUES($1,$2,$3,$4,$5,$6) RETURNING id,deployed_at`,
		el.OrderID, el.ProjectID, el.EnvironmentID, el.ProductID, el.Status, el.Parameters,
	).Scan(&el.ID, &el.DeployedAt)
}

func (r *infraRepo) UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE infrastructure_elements SET status=$1 WHERE id=$2`, string(status), id)
	return err
}

func scanInfra(row pgx.CollectableRow) (model.InfrastructureElement, error) {
	var el model.InfrastructureElement
	return el, row.Scan(&el.ID, &el.OrderID, &el.ProjectID, &el.EnvironmentID,
		&el.ProductID, &el.Status, &el.Parameters, &el.DeployedAt)
}
