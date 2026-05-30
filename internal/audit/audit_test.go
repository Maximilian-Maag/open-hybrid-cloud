package audit

import (
	"context"
	"errors"
	"testing"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/service"
)

type stubAuditRepo struct {
	entries []model.AuditEntry
	saveErr error
}

func (r *stubAuditRepo) Save(ctx context.Context, e *model.AuditEntry) error {
	if r.saveErr != nil {
		return r.saveErr
	}
	r.entries = append(r.entries, *e)
	return nil
}
func (r *stubAuditRepo) FindAll(ctx context.Context) ([]model.AuditEntry, error) {
	return r.entries, nil
}
func (r *stubAuditRepo) FindByUserID(ctx context.Context, uid int64) ([]model.AuditEntry, error) {
	var result []model.AuditEntry
	for _, e := range r.entries {
		if e.UserID == uid {
			result = append(result, e)
		}
	}
	return result, nil
}
func (r *stubAuditRepo) FindByAction(ctx context.Context, action model.AuditAction) ([]model.AuditEntry, error) {
	return nil, nil
}

func TestAuditService_Log_positive(t *testing.T) {
	repo := &stubAuditRepo{}
	svc := NewService(repo)

	entry := &model.AuditEntry{UserID: 1, Action: model.AuditActionOrderCreated, EntityID: 42}
	if err := svc.Log(context.Background(), entry); err != nil {
		t.Fatalf("Log: %v", err)
	}

	all, _ := svc.List(context.Background(), service.AuditFilter{})
	if len(all) != 1 {
		t.Errorf("List: want 1 entry, got %d", len(all))
	}
}

func TestAuditService_Log_negative_repoError(t *testing.T) {
	repo := &stubAuditRepo{saveErr: errors.New("db down")}
	svc := NewService(repo)

	err := svc.Log(context.Background(), &model.AuditEntry{UserID: 1, Action: model.AuditActionOrderCreated})
	if err == nil {
		t.Error("expected error when repo.Save fails, got nil")
	}
}
