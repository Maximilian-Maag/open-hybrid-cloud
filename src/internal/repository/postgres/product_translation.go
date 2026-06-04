package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/repository"
)

type translationRepo struct{ pool *pgxpool.Pool }

func NewProductTranslationRepository(pool *pgxpool.Pool) repository.ProductTranslationRepository {
	return &translationRepo{pool}
}

func (r *translationRepo) FindByProductID(ctx context.Context, productID int64) ([]model.ProductTranslation, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT product_id,language_code,name,description FROM product_translations
		 WHERE product_id=$1 ORDER BY language_code`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanTranslation)
}

func (r *translationRepo) FindByProductAndLang(ctx context.Context, productID int64, lang string) (*model.ProductTranslation, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT product_id,language_code,name,description FROM product_translations
		 WHERE product_id=$1 AND language_code=$2`, productID, lang)
	if err != nil {
		return nil, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, scanTranslation)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

func (r *translationRepo) Upsert(ctx context.Context, t *model.ProductTranslation) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO product_translations(product_id,language_code,name,description)
		 VALUES($1,$2,$3,$4)
		 ON CONFLICT(product_id,language_code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description`,
		t.ProductID, t.LanguageCode, t.Name, t.Description)
	return err
}

func scanTranslation(row pgx.CollectableRow) (model.ProductTranslation, error) {
	var t model.ProductTranslation
	return t, row.Scan(&t.ProductID, &t.LanguageCode, &t.Name, &t.Description)
}
