package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func newOrder(t *testing.T, f *fixture) *model.Order {
	t.Helper()
	o := &model.Order{
		ProjectID:     f.Project.ID,
		ProductID:     f.Product.ID,
		EnvironmentID: f.Env.ID,
		UserID:        f.User.ID,
		Status:        model.OrderStatusPendingApproval,
		Parameters:    map[string]string{"region": "eu-central"},
	}
	if err := NewOrderRepository(testPool).Save(context.Background(), o); err != nil {
		t.Fatalf("newOrder: Save: %v", err)
	}
	return o
}

func TestOrderRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	o := newOrder(t, f)
	if o.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, o.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Status != model.OrderStatusPendingApproval {
		t.Errorf("FindByID: want status pending_approval, got %v", got)
	}
	if got.Parameters["region"] != "eu-central" {
		t.Errorf("FindByID: parameters not round-tripped, got %v", got.Parameters)
	}
}

func TestOrderRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewOrderRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil, got %+v", got)
	}
}

func TestOrderRepo_FindByUserID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	newOrder(t, f)
	newOrder(t, f)

	orders, err := repo.FindByUserID(ctx, f.User.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(orders) != 2 {
		t.Errorf("FindByUserID: want 2, got %d", len(orders))
	}
}

func TestOrderRepo_FindByStatus(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	newOrder(t, f)
	o2 := newOrder(t, f)
	_ = repo.UpdateStatus(ctx, o2.ID, model.OrderStatusApproved)

	pending, err := repo.FindByStatus(ctx, model.OrderStatusPendingApproval)
	if err != nil {
		t.Fatalf("FindByStatus: %v", err)
	}
	if len(pending) != 1 {
		t.Errorf("FindByStatus(pending): want 1, got %d", len(pending))
	}
}

func TestOrderRepo_UpdateStatus(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	o := newOrder(t, f)
	if err := repo.UpdateStatus(ctx, o.ID, model.OrderStatusApproved); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	got, _ := repo.FindByID(ctx, o.ID)
	if got.Status != model.OrderStatusApproved {
		t.Errorf("UpdateStatus: want 'approved', got %q", got.Status)
	}
}

func TestOrderRepo_UpdateRejection(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	o := newOrder(t, f)
	if err := repo.UpdateRejection(ctx, o.ID, "budget exceeded"); err != nil {
		t.Fatalf("UpdateRejection: %v", err)
	}

	got, _ := repo.FindByID(ctx, o.ID)
	if got.Status != model.OrderStatusRejected {
		t.Errorf("UpdateRejection: want status 'rejected', got %q", got.Status)
	}
	if got.RejectionNote != "budget exceeded" {
		t.Errorf("UpdateRejection: want note 'budget exceeded', got %q", got.RejectionNote)
	}
}

func TestOrderRepo_AppendPipelineID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewOrderRepository(testPool)

	o := newOrder(t, f)
	if err := repo.AppendPipelineID(ctx, o.ID, "pipeline-1"); err != nil {
		t.Fatalf("AppendPipelineID: %v", err)
	}
	if err := repo.AppendPipelineID(ctx, o.ID, "pipeline-2"); err != nil {
		t.Fatalf("AppendPipelineID second: %v", err)
	}

	got, _ := repo.FindByID(ctx, o.ID)
	if len(got.PipelineIDs) != 2 {
		t.Errorf("AppendPipelineID: want 2 pipeline IDs, got %d: %v", len(got.PipelineIDs), got.PipelineIDs)
	}
}
