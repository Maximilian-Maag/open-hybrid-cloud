package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type auditRepo struct{ pool *pgxpool.Pool }

func NewAuditRepository(pool *pgxpool.Pool) repository.AuditRepository {
	return &auditRepo{pool}
}

const auditCols = `id,user_id,action,entity_id,details,created_at`

func (r *auditRepo) Save(ctx context.Context, e *model.AuditEntry) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO audit_log(user_id,action,entity_id,details) VALUES($1,$2,$3,$4) RETURNING id,created_at`,
		e.UserID, e.Action, e.EntityID, e.Details,
	).Scan(&e.ID, &e.CreatedAt)
}

func (r *auditRepo) FindAll(ctx context.Context) ([]model.AuditEntry, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+auditCols+` FROM audit_log ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanAudit)
}

func (r *auditRepo) FindByUserID(ctx context.Context, userID int64) ([]model.AuditEntry, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+auditCols+` FROM audit_log WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanAudit)
}

func (r *auditRepo) FindByAction(ctx context.Context, action model.AuditAction) ([]model.AuditEntry, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+auditCols+` FROM audit_log WHERE action=$1 ORDER BY created_at DESC`, string(action))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanAudit)
}

func scanAudit(row pgx.CollectableRow) (model.AuditEntry, error) {
	var e model.AuditEntry
	return e, row.Scan(&e.ID, &e.UserID, &e.Action, &e.EntityID, &e.Details, &e.CreatedAt)
}
