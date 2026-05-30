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

func (r *userRepo) FindByID(ctx context.Context, id int64) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT id,email,name,role,sso_sub,password_hash,created_at FROM users WHERE id=$1`, id)
}

func (r *userRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT id,email,name,role,sso_sub,password_hash,created_at FROM users WHERE email=$1`, email)
}

func (r *userRepo) FindBySSOSub(ctx context.Context, sub string) (*model.User, error) {
	return r.scanOne(ctx,
		`SELECT id,email,name,role,sso_sub,password_hash,created_at FROM users WHERE sso_sub=$1`, sub)
}

func (r *userRepo) FindByRole(ctx context.Context, role model.Role) ([]model.User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,email,name,role,sso_sub,password_hash,created_at FROM users WHERE role=$1 ORDER BY name`,
		string(role))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanUser)
}

func (r *userRepo) FindAll(ctx context.Context) ([]model.User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id,email,name,role,sso_sub,password_hash,created_at FROM users ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, scanUser)
}

func (r *userRepo) Save(ctx context.Context, u *model.User) error {
	return r.pool.QueryRow(ctx,
		`INSERT INTO users(email,name,role,sso_sub,password_hash) VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''))
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
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &ssoSub, &passwordHash, &u.CreatedAt)
	if ssoSub != nil {
		u.SSOSub = *ssoSub
	}
	if passwordHash != nil {
		u.PasswordHash = *passwordHash
	}
	return u, err
}
