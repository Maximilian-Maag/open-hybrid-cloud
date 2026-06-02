package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type parameterRepo struct{ pool *pgxpool.Pool }

func NewParameterRepository(pool *pgxpool.Pool) repository.ParameterRepository {
	return &parameterRepo{pool}
}

const paramCols = `id,scope,scope_id,environment_id,name,type,description,default_value,required,sensitive`

func (r *parameterRepo) FindByScope(ctx context.Context, scope model.ParameterScope, scopeID int64) ([]model.Parameter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+paramCols+` FROM parameters WHERE scope=$1 AND scope_id=$2 ORDER BY name`,
		string(scope), scopeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanParameter)
}

func (r *parameterRepo) FindByScopeAndEnv(ctx context.Context, scope model.ParameterScope, scopeID int64, envID int64) ([]model.Parameter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+paramCols+` FROM parameters WHERE scope=$1 AND scope_id=$2 AND (environment_id=0 OR environment_id=$3) ORDER BY name`,
		string(scope), scopeID, envID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanParameter)
}

func (r *parameterRepo) FindByID(ctx context.Context, id int64) (*model.Parameter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+paramCols+` FROM parameters WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanParameter)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *parameterRepo) Save(ctx context.Context, p *model.Parameter) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO parameters(scope,scope_id,environment_id,name,type,description,default_value,required,sensitive)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		string(p.Scope), p.ScopeID, p.EnvironmentID, p.Name, string(p.Type),
		p.Description, p.DefaultValue, p.Required, p.Sensitive,
	).Scan(&p.ID)
}

func (r *parameterRepo) Update(ctx context.Context, p *model.Parameter) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE parameters SET name=$1,type=$2,description=$3,default_value=$4,required=$5,sensitive=$6,environment_id=$7 WHERE id=$8`,
		p.Name, string(p.Type), p.Description, p.DefaultValue, p.Required, p.Sensitive, p.EnvironmentID, p.ID)
	return err
}

func (r *parameterRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM parameters WHERE id=$1`, id)
	return err
}

func scanParameter(row pgx.CollectableRow) (model.Parameter, error) {
	var p model.Parameter
	return p, row.Scan(&p.ID, &p.Scope, &p.ScopeID, &p.EnvironmentID, &p.Name, &p.Type,
		&p.Description, &p.DefaultValue, &p.Required, &p.Sensitive)
}
