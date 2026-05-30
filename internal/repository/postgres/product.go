package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type productRepo struct{ pool *pgxpool.Pool }

func NewProductRepository(pool *pgxpool.Pool) repository.ProductRepository {
	return &productRepo{pool}
}

func (r *productRepo) FindAll(ctx context.Context) ([]model.Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,category_id,base_language,image,created_at FROM products ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanProduct)
}

func (r *productRepo) FindByID(ctx context.Context, id int64) (*model.Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,category_id,base_language,image,created_at FROM products WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	p, err := pgx.CollectExactlyOneRow(rows, scanProduct)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *productRepo) FindByCategoryID(ctx context.Context, categoryID int64) ([]model.Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,category_id,base_language,image,created_at FROM products WHERE category_id=$1 ORDER BY id`,
		categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanProduct)
}

func (r *productRepo) Save(ctx context.Context, p *model.Product) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO products(category_id,base_language,image) VALUES($1,$2,$3) RETURNING id,created_at`,
		p.CategoryID, p.BaseLanguage, p.Image,
	).Scan(&p.ID, &p.CreatedAt)
}

func (r *productRepo) Update(ctx context.Context, p *model.Product) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE products SET category_id=$1,base_language=$2,image=$3 WHERE id=$4`,
		p.CategoryID, p.BaseLanguage, p.Image, p.ID)
	return err
}

func (r *productRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM products WHERE id=$1`, id)
	return err
}

func scanProduct(row pgx.CollectableRow) (model.Product, error) {
	var p model.Product
	return p, row.Scan(&p.ID, &p.CategoryID, &p.BaseLanguage, &p.Image, &p.CreatedAt)
}
