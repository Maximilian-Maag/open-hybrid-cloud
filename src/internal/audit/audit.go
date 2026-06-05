// Package audit implementiert den AuditService.
package audit

import (
	"context"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service"
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
	if filter.UserID != 0 || filter.Action != "" || filter.From != nil || filter.To != nil {
		return s.repo.FindFiltered(ctx, filter.UserID, filter.Action, filter.From, filter.To)
	}
	return s.repo.FindAll(ctx)
}
