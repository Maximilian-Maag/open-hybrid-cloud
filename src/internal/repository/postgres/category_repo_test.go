package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestCategoryRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCategoryRepository(testPool)

	c := &model.Category{Name: "Compute", DisplayOrder: 1}
	if err := repo.Save(ctx, c); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if c.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Name != "Compute" {
		t.Errorf("FindByID: want Name='Compute', got %v", got)
	}
}

func TestCategoryRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewCategoryRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestCategoryRepo_FindAll(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCategoryRepository(testPool)

	_ = repo.Save(ctx, &model.Category{Name: "Networking", DisplayOrder: 2})
	_ = repo.Save(ctx, &model.Category{Name: "Storage", DisplayOrder: 3})

	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("FindAll: want 2, got %d", len(all))
	}
}

func TestCategoryRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCategoryRepository(testPool)

	c := &model.Category{Name: "Old Name", DisplayOrder: 0}
	_ = repo.Save(ctx, c)

	c.Name = "New Name"
	c.DisplayOrder = 5
	if err := repo.Update(ctx, c); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, c.ID)
	if got.Name != "New Name" || got.DisplayOrder != 5 {
		t.Errorf("Update: want Name='New Name' Order=5, got %+v", got)
	}
}

func TestCategoryRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewCategoryRepository(testPool)

	c := &model.Category{Name: "ToDelete"}
	_ = repo.Save(ctx, c)
	if err := repo.Delete(ctx, c.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, _ := repo.FindByID(ctx, c.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
