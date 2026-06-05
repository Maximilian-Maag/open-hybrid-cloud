package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestCostCenterRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCostCenterRepository(testPool)

	cc := &model.CostCenter{Code: "CC-001", Name: "Engineering", Active: true}
	if err := repo.Save(ctx, cc); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if cc.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, cc.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Code != "CC-001" {
		t.Errorf("FindByID: want Code='CC-001', got %v", got)
	}
	if !got.Active {
		t.Error("FindByID: want Active=true")
	}
}

func TestCostCenterRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewCostCenterRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestCostCenterRepo_FindAll(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCostCenterRepository(testPool)

	_ = repo.Save(ctx, &model.CostCenter{Code: "A", Name: "Alpha", Active: true})
	_ = repo.Save(ctx, &model.CostCenter{Code: "B", Name: "Beta", Active: false})

	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("FindAll: want 2, got %d", len(all))
	}
}

func TestCostCenterRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCostCenterRepository(testPool)

	cc := &model.CostCenter{Code: "OLD", Name: "Old Name", Active: true}
	_ = repo.Save(ctx, cc)

	cc.Code = "NEW"
	cc.Name = "New Name"
	cc.Active = false
	if err := repo.Update(ctx, cc); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, cc.ID)
	if got.Code != "NEW" || got.Name != "New Name" || got.Active {
		t.Errorf("Update: want Code='NEW' Name='New Name' Active=false, got %+v", got)
	}
}
