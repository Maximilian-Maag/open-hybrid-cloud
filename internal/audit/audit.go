// Package audit implementiert den AuditService.
package audit

import (
	"context"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
)

type auditService struct {
	repo repository.AuditRepository
}

func NewService(repo repository.AuditRepository) service.AuditService {
	return &auditService{repo: repo}
}

func (s *auditService) Log(ctx context.Context, entry *model.AuditEntry) error {
	return s.repo.Save(ctx, entry)
}

func (s *auditService) List(ctx context.Context, filter service.AuditFilter) ([]model.AuditEntry, error) {
	if filter.UserID != 0 {
		return s.repo.FindByUserID(ctx, filter.UserID)
	}
	if filter.Action != "" {
		return s.repo.FindByAction(ctx, filter.Action)
	}
	return s.repo.FindAll(ctx)
}
