package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type appConfigRepo struct{ pool *pgxpool.Pool }

func NewAppConfigRepository(pool *pgxpool.Pool) repository.AppConfigRepository {
	return &appConfigRepo{pool}
}

func (r *appConfigRepo) Load(ctx context.Context) (*model.AppConfig, error) {
	var c model.AppConfig
	err := r.pool.QueryRow(ctx,
		`SELECT smtp_host,smtp_port,smtp_from,smtp_username,smtp_password,smtp_tls,
		        ai_provider,ai_endpoint,ai_api_key,ai_model
		 FROM app_config WHERE id=1`,
	).Scan(&c.SMTPHost, &c.SMTPPort, &c.SMTPFrom, &c.SMTPUsername, &c.SMTPPassword, &c.SMTPTLS,
		&c.AIProvider, &c.AIEndpoint, &c.AIAPIKey, &c.AIModel)
	if err != nil {
		return &model.AppConfig{}, nil
	}
	return &c, nil
}

func (r *appConfigRepo) Save(ctx context.Context, c *model.AppConfig) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO app_config(id,smtp_host,smtp_port,smtp_from,smtp_username,smtp_password,smtp_tls,
		                        ai_provider,ai_endpoint,ai_api_key,ai_model)
		 VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT(id) DO UPDATE SET
		   smtp_host=EXCLUDED.smtp_host, smtp_port=EXCLUDED.smtp_port,
		   smtp_from=EXCLUDED.smtp_from, smtp_username=EXCLUDED.smtp_username,
		   smtp_password=EXCLUDED.smtp_password, smtp_tls=EXCLUDED.smtp_tls,
		   ai_provider=EXCLUDED.ai_provider, ai_endpoint=EXCLUDED.ai_endpoint,
		   ai_api_key=EXCLUDED.ai_api_key, ai_model=EXCLUDED.ai_model`,
		c.SMTPHost, c.SMTPPort, c.SMTPFrom, c.SMTPUsername, c.SMTPPassword, c.SMTPTLS,
		c.AIProvider, c.AIEndpoint, c.AIAPIKey, c.AIModel)
	return err
}
