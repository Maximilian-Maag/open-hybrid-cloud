package audit

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service"
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
func (r *stubAuditRepo) FindFiltered(ctx context.Context, userID int64, action model.AuditAction, from, to *time.Time) ([]model.AuditEntry, error) {
	return r.entries, nil
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

func TestAuditService_List_withFilter_positive(t *testing.T) {
	repo := &stubAuditRepo{}
	svc := NewService(repo)

	_ = svc.Log(context.Background(), &model.AuditEntry{UserID: 1, Action: model.AuditActionOrderCreated})
	_ = svc.Log(context.Background(), &model.AuditEntry{UserID: 2, Action: model.AuditActionOrderApproved})

	// Filter by UserID — stubAuditRepo.FindFiltered returns all entries; test that no error occurs
	now := time.Now()
	results, err := svc.List(context.Background(), service.AuditFilter{
		UserID: 1,
		From:   &now,
	})
	if err != nil {
		t.Fatalf("List with filter: unexpected error: %v", err)
	}
	if results == nil {
		t.Error("List with filter: expected non-nil slice")
	}
}

func TestAuditService_List_noFilter_positive(t *testing.T) {
	repo := &stubAuditRepo{}
	svc := NewService(repo)

	for i := 0; i < 3; i++ {
		_ = svc.Log(context.Background(), &model.AuditEntry{
			UserID: int64(i + 1),
			Action: model.AuditActionOrderCreated,
		})
	}

	results, err := svc.List(context.Background(), service.AuditFilter{})
	if err != nil {
		t.Fatalf("List no filter: %v", err)
	}
	if len(results) != 3 {
		t.Errorf("List no filter: want 3 entries, got %d", len(results))
	}
}
