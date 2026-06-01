package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type environmentRepo struct{ pool *pgxpool.Pool }

func NewEnvironmentRepository(pool *pgxpool.Pool) repository.EnvironmentRepository {
	return &environmentRepo{pool}
}

const envCols = `id,name,description,gitlab_source_id,webhook_url,webhook_token`

func (r *environmentRepo) FindAll(ctx context.Context) ([]model.DeploymentEnvironment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+envCols+` FROM deployment_environments ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanEnvironment)
}

func (r *environmentRepo) FindByID(ctx context.Context, id int64) (*model.DeploymentEnvironment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+envCols+` FROM deployment_environments WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	env, err := pgx.CollectExactlyOneRow(rows, scanEnvironment)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &env, err
}

func (r *environmentRepo) Save(ctx context.Context, env *model.DeploymentEnvironment) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO deployment_environments(name,description,gitlab_source_id,webhook_url,webhook_token)
		 VALUES($1,$2,$3,$4,$5) RETURNING id`,
		env.Name, env.Description, env.GitLabSourceID, env.WebhookURL, env.WebhookToken,
	).Scan(&env.ID)
}

func (r *environmentRepo) Update(ctx context.Context, env *model.DeploymentEnvironment) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE deployment_environments SET name=$1,description=$2,gitlab_source_id=$3,webhook_url=$4,webhook_token=$5 WHERE id=$6`,
		env.Name, env.Description, env.GitLabSourceID, env.WebhookURL, env.WebhookToken, env.ID)
	return err
}

func (r *environmentRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM deployment_environments WHERE id=$1`, id)
	return err
}

func scanEnvironment(row pgx.CollectableRow) (model.DeploymentEnvironment, error) {
	var e model.DeploymentEnvironment
	return e, row.Scan(&e.ID, &e.Name, &e.Description, &e.GitLabSourceID, &e.WebhookURL, &e.WebhookToken)
}
