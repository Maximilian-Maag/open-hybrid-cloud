package impl

import (
	"context"
	"testing"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type stubUserRepo struct {
	saved *model.User
}

func (r *stubUserRepo) Save(ctx context.Context, u *model.User) error {
	u.Active = true
	r.saved = u
	return nil
}
func (r *stubUserRepo) Update(ctx context.Context, u *model.User) error { return nil }
func (r *stubUserRepo) FindByID(ctx context.Context, id int64) (*model.User, error) {
	if r.saved != nil && r.saved.ID == id {
		return r.saved, nil
	}
	return nil, nil
}
func (r *stubUserRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	if r.saved != nil && r.saved.Email == email {
		return r.saved, nil
	}
	return nil, nil
}
func (r *stubUserRepo) FindBySSOSub(ctx context.Context, sub string) (*model.User, error) {
	return nil, nil
}
func (r *stubUserRepo) FindByRole(ctx context.Context, role model.Role) ([]model.User, error) {
	return nil, nil
}
func (r *stubUserRepo) FindAll(ctx context.Context) ([]model.User, error) { return nil, nil }
func (r *stubUserRepo) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	if r.saved != nil && r.saved.ID == id {
		r.saved.PasswordHash = passwordHash
	}
	return nil
}
func (r *stubUserRepo) SetActive(ctx context.Context, id int64, active bool) error { return nil }
func (r *stubUserRepo) Delete(ctx context.Context, id int64) error                 { return nil }

var _ repository.UserRepository = (*stubUserRepo)(nil)

func TestUserService_Create_positive(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "alice@example.com", Name: "Alice", Role: model.RoleAdmin}
	if err := svc.Create(context.Background(), u, "s3cr3t"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if repo.saved == nil {
		t.Fatal("expected repo.Save to be called")
	}
	if repo.saved.PasswordHash == "" {
		t.Error("expected PasswordHash to be set after Create with password")
	}
}

func TestUserService_VerifyPassword_positive(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "alice@example.com"}
	_ = svc.Create(context.Background(), u, "correct")

	result, err := svc.VerifyPassword(context.Background(), "alice@example.com", "correct")
	if err != nil {
		t.Fatalf("VerifyPassword: unexpected error: %v", err)
	}
	if result == nil {
		t.Error("VerifyPassword: expected user for correct password, got nil")
	}
}

func TestUserService_VerifyPassword_negative_wrongPassword(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "bob@example.com"}
	_ = svc.Create(context.Background(), u, "correct")

	result, err := svc.VerifyPassword(context.Background(), "bob@example.com", "wrong-password")
	if err != nil {
		t.Fatalf("VerifyPassword: unexpected error: %v", err)
	}
	if result != nil {
		t.Error("VerifyPassword: expected nil for wrong password, got user")
	}
}

func TestUserService_VerifyPassword_negative_inactiveUser(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "carol@example.com"}
	_ = svc.Create(context.Background(), u, "secret")
	repo.saved.Active = false

	result, err := svc.VerifyPassword(context.Background(), "carol@example.com", "secret")
	if err != nil {
		t.Fatalf("VerifyPassword: unexpected error: %v", err)
	}
	if result != nil {
		t.Error("VerifyPassword: expected nil for inactive user, got user")
	}
}

func TestUserService_ChangePassword_positive(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "dave@example.com"}
	_ = svc.Create(context.Background(), u, "old-pass")
	oldHash := repo.saved.PasswordHash

	err := svc.ChangePassword(context.Background(), repo.saved.ID, "old-pass", "new-pass")
	if err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if repo.saved.PasswordHash == oldHash {
		t.Error("ChangePassword: expected password hash to change")
	}
}

func TestUserService_ChangePassword_negative_wrongCurrentPassword(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "eve@example.com"}
	_ = svc.Create(context.Background(), u, "real-pass")

	err := svc.ChangePassword(context.Background(), repo.saved.ID, "wrong-current", "new-pass")
	if err == nil {
		t.Error("ChangePassword: expected error for wrong current password, got nil")
	}
}

func TestUserService_SetActive_positive(t *testing.T) {
	repo := &stubUserRepo{}
	svc := NewUserService(repo)

	u := &model.User{Email: "frank@example.com"}
	_ = svc.Create(context.Background(), u, "pass")

	if err := svc.SetActive(context.Background(), repo.saved.ID, false); err != nil {
		t.Fatalf("SetActive(false): %v", err)
	}
	if err := svc.SetActive(context.Background(), repo.saved.ID, true); err != nil {
		t.Fatalf("SetActive(true): %v", err)
	}
}
