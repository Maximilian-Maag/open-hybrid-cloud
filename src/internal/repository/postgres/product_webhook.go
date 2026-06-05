package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
)

type productWebhookRepo struct{ pool *pgxpool.Pool }

func NewProductWebhookRepository(pool *pgxpool.Pool) repository.ProductWebhookRepository {
	return &productWebhookRepo{pool}
}

func (r *productWebhookRepo) FindByProductAndEnv(ctx context.Context, productID, envID int64) ([]model.ProductWebhook, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,product_id,environment_id,name,webhook_url,webhook_token,exec_order
		 FROM product_webhooks WHERE product_id=$1 AND environment_id=$2 ORDER BY exec_order`,
		productID, envID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.ProductWebhook, error) {
		var pw model.ProductWebhook
		return pw, row.Scan(&pw.ID, &pw.ProductID, &pw.EnvironmentID, &pw.Name, &pw.WebhookURL, &pw.WebhookToken, &pw.ExecOrder)
	})
}

func (r *productWebhookRepo) Save(ctx context.Context, pw *model.ProductWebhook) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO product_webhooks(product_id,environment_id,name,webhook_url,webhook_token,exec_order)
		 VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
		pw.ProductID, pw.EnvironmentID, pw.Name, pw.WebhookURL, pw.WebhookToken, pw.ExecOrder,
	).Scan(&pw.ID)
}

func (r *productWebhookRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM product_webhooks WHERE id=$1`, id)
	return err
}
