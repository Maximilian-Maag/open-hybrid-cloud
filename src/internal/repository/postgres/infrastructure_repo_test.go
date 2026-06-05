package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func newInfraElement(t *testing.T, f *fixture, o *model.Order) *model.InfrastructureElement {
	t.Helper()
	el := &model.InfrastructureElement{
		OrderID:       o.ID,
		ProjectID:     f.Project.ID,
		EnvironmentID: f.Env.ID,
		ProductID:     f.Product.ID,
		Status:        model.OrderStatusProvisioning,
		Parameters:    map[string]string{"size": "small"},
	}
	if err := NewInfrastructureRepository(testPool).Save(context.Background(), el); err != nil {
		t.Fatalf("newInfraElement: Save: %v", err)
	}
	return el
}

func TestInfraRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el := newInfraElement(t, f, o)
	if el.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, el.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Status != model.OrderStatusProvisioning {
		t.Errorf("FindByID: want status 'provisioning', got %v", got)
	}
	if got.Parameters["size"] != "small" {
		t.Errorf("FindByID: parameters not round-tripped, got %v", got.Parameters)
	}
}

func TestInfraRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewInfrastructureRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil, got %+v", got)
	}
}

func TestInfraRepo_FindByProjectID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o1 := newOrder(t, f)
	o2 := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	newInfraElement(t, f, o1)
	newInfraElement(t, f, o2)

	elements, err := repo.FindByProjectID(ctx, f.Project.ID)
	if err != nil {
		t.Fatalf("FindByProjectID: %v", err)
	}
	if len(elements) != 2 {
		t.Errorf("FindByProjectID: want 2, got %d", len(elements))
	}
}

func TestInfraRepo_FindByStatuses(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o1 := newOrder(t, f)
	o2 := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el1 := newInfraElement(t, f, o1)
	newInfraElement(t, f, o2)
	_ = repo.UpdateStatus(ctx, el1.ID, model.OrderStatusCompleted)

	provisioning, err := repo.FindByStatuses(ctx, []model.OrderStatus{model.OrderStatusProvisioning})
	if err != nil {
		t.Fatalf("FindByStatuses: %v", err)
	}
	if len(provisioning) != 1 {
		t.Errorf("FindByStatuses(provisioning): want 1, got %d", len(provisioning))
	}

	both, err := repo.FindByStatuses(ctx, []model.OrderStatus{model.OrderStatusProvisioning, model.OrderStatusCompleted})
	if err != nil {
		t.Fatalf("FindByStatuses: %v", err)
	}
	if len(both) != 2 {
		t.Errorf("FindByStatuses(provisioning+completed): want 2, got %d", len(both))
	}
}

func TestInfraRepo_UpdateStatus(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el := newInfraElement(t, f, o)
	if err := repo.UpdateStatus(ctx, el.ID, model.OrderStatusCompleted); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	got, _ := repo.FindByID(ctx, el.ID)
	if got.Status != model.OrderStatusCompleted {
		t.Errorf("UpdateStatus: want 'completed', got %q", got.Status)
	}
}

func TestInfraRepo_AppendPipelineID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el := newInfraElement(t, f, o)
	_ = repo.AppendPipelineID(ctx, el.ID, "pipe-1")
	_ = repo.AppendPipelineID(ctx, el.ID, "pipe-2")

	got, _ := repo.FindByID(ctx, el.ID)
	if len(got.PipelineIDs) != 2 {
		t.Errorf("AppendPipelineID: want 2, got %d: %v", len(got.PipelineIDs), got.PipelineIDs)
	}
}

func TestInfraRepo_UpdateOutputs(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el := newInfraElement(t, f, o)
	outputs := map[string]string{"ip": "10.0.0.1", "hostname": "vm-1"}
	if err := repo.UpdateOutputs(ctx, el.ID, outputs); err != nil {
		t.Fatalf("UpdateOutputs: %v", err)
	}

	got, _ := repo.FindByID(ctx, el.ID)
	if got.Outputs["ip"] != "10.0.0.1" || got.Outputs["hostname"] != "vm-1" {
		t.Errorf("UpdateOutputs: outputs not round-tripped, got %v", got.Outputs)
	}
}

func TestInfraRepo_FindByOrderID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	o := newOrder(t, f)
	ctx := context.Background()
	repo := NewInfrastructureRepository(testPool)

	el := newInfraElement(t, f, o)

	got, err := repo.FindByOrderID(ctx, o.ID)
	if err != nil {
		t.Fatalf("FindByOrderID: %v", err)
	}
	if got == nil || got.ID != el.ID {
		t.Errorf("FindByOrderID: want ID %d, got %v", el.ID, got)
	}
}
