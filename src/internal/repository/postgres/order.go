package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/repository"
)

type orderRepo struct{ pool *pgxpool.Pool }

func NewOrderRepository(pool *pgxpool.Pool) repository.OrderRepository {
	return &orderRepo{pool}
}

const orderCols = `id,project_id,product_id,environment_id,user_id,status,
	parameters,cost_center_id,rejection_note,pipeline_id,created_at,updated_at`

func (r *orderRepo) FindByID(ctx context.Context, id int64) (*model.Order, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+orderCols+` FROM orders WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	o, err := pgx.CollectExactlyOneRow(rows, scanOrder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &o, err
}

func (r *orderRepo) FindByUserID(ctx context.Context, userID int64) ([]model.Order, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+orderCols+` FROM orders WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanOrder)
}

func (r *orderRepo) FindByStatus(ctx context.Context, status model.OrderStatus) ([]model.Order, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+orderCols+` FROM orders WHERE status=$1 ORDER BY created_at`, string(status))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanOrder)
}

func (r *orderRepo) Save(ctx context.Context, o *model.Order) error {
	var ccID *int64
	if o.CostCenterID != 0 {
		ccID = &o.CostCenterID
	}
	return r.pool.QueryRow(ctx,
		`INSERT INTO orders(project_id,product_id,environment_id,user_id,status,parameters,cost_center_id)
		 VALUES($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id,created_at,updated_at`,
		o.ProjectID, o.ProductID, o.EnvironmentID, o.UserID, o.Status, o.Parameters, ccID,
	).Scan(&o.ID, &o.CreatedAt, &o.UpdatedAt)
}

func (r *orderRepo) UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2`, string(status), id)
	return err
}

func (r *orderRepo) UpdateRejection(ctx context.Context, id int64, note string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE orders SET status='rejected',rejection_note=$1,updated_at=NOW() WHERE id=$2`, note, id)
	return err
}

// AppendPipelineID adds a pipeline ID to the JSONB array stored in pipeline_id.
func (r *orderRepo) AppendPipelineID(ctx context.Context, id int64, pipelineID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE orders SET pipeline_id = pipeline_id || to_jsonb($1::text), updated_at=NOW() WHERE id=$2`,
		pipelineID, id)
	return err
}

func scanOrder(row pgx.CollectableRow) (model.Order, error) {
	var o model.Order
	var ccID *int64
	err := row.Scan(
		&o.ID, &o.ProjectID, &o.ProductID, &o.EnvironmentID, &o.UserID,
		&o.Status, &o.Parameters, &ccID,
		&o.RejectionNote, &o.PipelineIDs, &o.CreatedAt, &o.UpdatedAt,
	)
	if ccID != nil {
		o.CostCenterID = *ccID
	}
	return o, err
}
