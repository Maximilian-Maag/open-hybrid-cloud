package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestAuditRepo_SaveAndFindAll(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewAuditRepository(testPool)

	e := &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 42}
	if err := repo.Save(ctx, e); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if e.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 1 {
		t.Errorf("FindAll: want 1, got %d", len(all))
	}
}

func TestAuditRepo_FindByUserID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewAuditRepository(testPool)

	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 1})
	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderApproved, EntityID: 1})

	entries, err := repo.FindByUserID(ctx, f.User.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("FindByUserID: want 2, got %d", len(entries))
	}
}

func TestAuditRepo_FindByAction(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewAuditRepository(testPool)

	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 1})
	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 2})
	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderRejected, EntityID: 3})

	entries, err := repo.FindByAction(ctx, model.AuditActionOrderCreated)
	if err != nil {
		t.Fatalf("FindByAction: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("FindByAction(order.created): want 2, got %d", len(entries))
	}
}

func TestAuditRepo_FindFiltered_byUser(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewAuditRepository(testPool)

	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 1})
	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderRejected, EntityID: 2})

	entries, err := repo.FindFiltered(ctx, f.User.ID, "", nil, nil)
	if err != nil {
		t.Fatalf("FindFiltered: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("FindFiltered(userID): want 2, got %d", len(entries))
	}
}

func TestAuditRepo_FindFiltered_byTimeRange(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewAuditRepository(testPool)

	_ = repo.Save(ctx, &model.AuditEntry{UserID: f.User.ID, Action: model.AuditActionOrderCreated, EntityID: 1})

	from := time.Now().Add(-time.Minute)
	to := time.Now().Add(time.Minute)
	entries, err := repo.FindFiltered(ctx, 0, "", &from, &to)
	if err != nil {
		t.Fatalf("FindFiltered(time range): %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("FindFiltered(time range): want 1, got %d", len(entries))
	}

	future := time.Now().Add(time.Hour)
	entries, err = repo.FindFiltered(ctx, 0, "", &future, nil)
	if err != nil {
		t.Fatalf("FindFiltered(future from): %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("FindFiltered(future from): want 0, got %d", len(entries))
	}
}
