package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type userRepo struct{ pool *pgxpool.Pool }

func NewUserRepository(pool *pgxpool.Pool) repository.UserRepository {
	return &userRepo{pool}
}

const userCols = `id,email,name,role,active,sso_sub,password_hash,created_at`

func (r *userRepo) FindByID(ctx context.Context, id int64) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT `+userCols+` FROM users WHERE id=$1`, id)
}

func (r *userRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT `+userCols+` FROM users WHERE email=$1`, email)
}

func (r *userRepo) FindBySSOSub(ctx context.Context, sub string) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT `+userCols+` FROM users WHERE sso_sub=$1`, sub)
}

func (r *userRepo) FindByRole(ctx context.Context, role model.Role) ([]model.User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+userCols+` FROM users WHERE role=$1 ORDER BY name`,
		string(role))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanUser)
}

func (r *userRepo) FindAll(ctx context.Context) ([]model.User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+userCols+` FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanUser)
}

func (r *userRepo) Save(ctx context.Context, u *model.User) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO users(email,name,role,active,sso_sub,password_hash) VALUES($1,$2,$3,TRUE,NULLIF($4,''),NULLIF($5,''))
		 RETURNING id,created_at`,
		u.Email, u.Name, u.Role, u.SSOSub, u.PasswordHash,
	).Scan(&u.ID, &u.CreatedAt)
}

func (r *userRepo) Update(ctx context.Context, u *model.User) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET email=$1,name=$2,role=$3 WHERE id=$4`,
		u.Email, u.Name, u.Role, u.ID)
	return err
}

func (r *userRepo) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET password_hash=$1 WHERE id=$2`,
		passwordHash, id)
	return err
}

func (r *userRepo) SetActive(ctx context.Context, id int64, active bool) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET active=$1 WHERE id=$2`,
		active, id)
	return err
}

func (r *userRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
	return err
}

func (r *userRepo) scanOne(ctx context.Context, sql string, args ...any) (*model.User, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	u, err := pgx.CollectExactlyOneRow(rows, scanUser)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

func scanUser(row pgx.CollectableRow) (model.User, error) {
	var u model.User
	var ssoSub, passwordHash *string
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &ssoSub, &passwordHash, &u.CreatedAt)
	if ssoSub != nil {
		u.SSOSub = *ssoSub
	}
	if passwordHash != nil {
		u.PasswordHash = *passwordHash
	}
	return u, err
}
