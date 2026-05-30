package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type projectRepo struct{ pool *pgxpool.Pool }

func NewProjectRepository(pool *pgxpool.Pool) repository.ProjectRepository {
	return &projectRepo{pool}
}

const projectCols = `id,name,description,owner_id,cost_center_id,created_at`

func (r *projectRepo) FindByID(ctx context.Context, id int64) (*model.Project, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanProject)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *projectRepo) FindByOwnerID(ctx context.Context, ownerID int64) ([]model.Project, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE owner_id=$1 ORDER BY name`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanProject)
}

func (r *projectRepo) FindAll(ctx context.Context) ([]model.Project, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanProject)
}

func (r *projectRepo) Save(ctx context.Context, p *model.Project) error {
	var ccID *int64
	if p.CostCenterID != 0 {
		ccID = &p.CostCenterID
	}
	return r.pool.QueryRow(ctx,
		`INSERT INTO projects(name,description,owner_id,cost_center_id) VALUES($1,$2,$3,$4)
		 RETURNING id,created_at`,
		p.Name, p.Description, p.OwnerID, ccID,
	).Scan(&p.ID, &p.CreatedAt)
}

func (r *projectRepo) Update(ctx context.Context, p *model.Project) error {
	var ccID *int64
	if p.CostCenterID != 0 {
		ccID = &p.CostCenterID
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE projects SET name=$1,description=$2,cost_center_id=$3 WHERE id=$4`,
		p.Name, p.Description, ccID, p.ID)
	return err
}

func scanProject(row pgx.CollectableRow) (model.Project, error) {
	var p model.Project
	var ccID *int64
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &ccID, &p.CreatedAt)
	if ccID != nil {
		p.CostCenterID = *ccID
	}
	return p, err
}
