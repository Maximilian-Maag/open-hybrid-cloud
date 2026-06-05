package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
)

type categoryRepo struct{ pool *pgxpool.Pool }

func NewCategoryRepository(pool *pgxpool.Pool) repository.CategoryRepository {
	return &categoryRepo{pool}
}

func (r *categoryRepo) FindAll(ctx context.Context) ([]model.Category, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,name,display_order FROM categories ORDER BY display_order,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanCategory)
}

func (r *categoryRepo) FindByID(ctx context.Context, id int64) (*model.Category, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,name,display_order FROM categories WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	c, err := pgx.CollectExactlyOneRow(rows, scanCategory)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (r *categoryRepo) Save(ctx context.Context, c *model.Category) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO categories(name,display_order) VALUES($1,$2) RETURNING id`,
		c.Name, c.DisplayOrder,
	).Scan(&c.ID)
}

func (r *categoryRepo) Update(ctx context.Context, c *model.Category) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE categories SET name=$1,display_order=$2 WHERE id=$3`,
		c.Name, c.DisplayOrder, c.ID)
	return err
}

func (r *categoryRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM categories WHERE id=$1`, id)
	return err
}

func scanCategory(row pgx.CollectableRow) (model.Category, error) {
	var c model.Category
	return c, row.Scan(&c.ID, &c.Name, &c.DisplayOrder)
}
