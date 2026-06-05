package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
)

type gitlabSourceRepo struct{ pool *pgxpool.Pool }

func NewGitLabSourceRepository(pool *pgxpool.Pool) repository.GitLabSourceRepository {
	return &gitlabSourceRepo{pool}
}

func (r *gitlabSourceRepo) FindAll(ctx context.Context) ([]model.GitLabSource, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,name,url,access_token FROM gitlab_sources ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanGitLabSource)
}

func (r *gitlabSourceRepo) FindByID(ctx context.Context, id int64) (*model.GitLabSource, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,name,url,access_token FROM gitlab_sources WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	s, err := pgx.CollectExactlyOneRow(rows, scanGitLabSource)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func (r *gitlabSourceRepo) Save(ctx context.Context, s *model.GitLabSource) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO gitlab_sources(name,url,access_token) VALUES($1,$2,$3) RETURNING id`,
		s.Name, s.URL, s.AccessToken,
	).Scan(&s.ID)
}

func (r *gitlabSourceRepo) Update(ctx context.Context, s *model.GitLabSource) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE gitlab_sources SET name=$1,url=$2,access_token=$3 WHERE id=$4`,
		s.Name, s.URL, s.AccessToken, s.ID)
	return err
}

func (r *gitlabSourceRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM gitlab_sources WHERE id=$1`, id)
	return err
}

func scanGitLabSource(row pgx.CollectableRow) (model.GitLabSource, error) {
	var s model.GitLabSource
	return s, row.Scan(&s.ID, &s.Name, &s.URL, &s.AccessToken)
}
