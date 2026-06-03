package impl

import (
	"context"
	"fmt"

	"github.com/porr-ag/infra-webshop/internal/auth"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
)

type userService struct {
	repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) service.UserService {
	return &userService{repo}
}

func (s *userService) GetByID(ctx context.Context, id int64) (*model.User, error) {
	return s.repo.FindByID(ctx, id)
}

func (s *userService) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	return s.repo.FindByEmail(ctx, email)
}

func (s *userService) GetBySSOSub(ctx context.Context, sub string) (*model.User, error) {
	return s.repo.FindBySSOSub(ctx, sub)
}

func (s *userService) ListAll(ctx context.Context) ([]model.User, error) {
	return s.repo.FindAll(ctx)
}

func (s *userService) Create(ctx context.Context, u *model.User, password string) error {
	if password != "" {
		hash, err := auth.HashPassword(password)
		if err != nil {
			return fmt.Errorf("hash password: %w", err)
		}
		u.PasswordHash = hash
	}
	return s.repo.Save(ctx, u)
}

func (s *userService) Update(ctx context.Context, u *model.User) error {
	return s.repo.Update(ctx, u)
}

func (s *userService) VerifyPassword(ctx context.Context, email, password string) (*model.User, error) {
	u, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if u == nil || !u.Active || !auth.CheckPassword(u.PasswordHash, password) {
		return nil, nil
	}
	return u, nil
}

func (s *userService) ChangePassword(ctx context.Context, id int64, currentPassword, newPassword string) error {
	u, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if u == nil {
		return fmt.Errorf("user not found")
	}
	if !auth.CheckPassword(u.PasswordHash, currentPassword) {
		return fmt.Errorf("current password incorrect")
	}
	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.repo.UpdatePassword(ctx, id, hash)
}

func (s *userService) SetActive(ctx context.Context, id int64, active bool) error {
	return s.repo.SetActive(ctx, id, active)
}

func (s *userService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

func (s *userService) UpsertSSO(ctx context.Context, sub, email, name string, role model.Role) (*model.User, error) {
	u, err := s.repo.FindBySSOSub(ctx, sub)
	if err != nil {
		return nil, err
	}
	if u != nil {
		return u, nil
	}
	u = &model.User{
		Email:  email,
		Name:   name,
		Role:   role,
		SSOSub: sub,
	}
	if err := s.repo.Save(ctx, u); err != nil {
		return nil, fmt.Errorf("create sso user: %w", err)
	}
	return u, nil
}
