package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestProjectRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProjectRepository(testPool)

	p := &model.Project{Name: "Alpha", Description: "desc", OwnerID: f.User.ID}
	if err := repo.Save(ctx, p); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if p.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, p.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Name != "Alpha" {
		t.Errorf("FindByID: want Name='Alpha', got %v", got)
	}
	if got.OwnerID != f.User.ID {
		t.Errorf("FindByID: want OwnerID=%d, got %d", f.User.ID, got.OwnerID)
	}
}

func TestProjectRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewProjectRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil, got %+v", got)
	}
}

func TestProjectRepo_FindByOwnerID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProjectRepository(testPool)

	_ = repo.Save(ctx, &model.Project{Name: "P1", OwnerID: f.User.ID})
	_ = repo.Save(ctx, &model.Project{Name: "P2", OwnerID: f.User.ID})

	projects, err := repo.FindByOwnerID(ctx, f.User.ID)
	if err != nil {
		t.Fatalf("FindByOwnerID: %v", err)
	}
	if len(projects) != 3 { // 2 new + 1 from fixture
		t.Errorf("FindByOwnerID: want 3, got %d", len(projects))
	}
}

func TestProjectRepo_FindAll(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProjectRepository(testPool)

	_ = repo.Save(ctx, &model.Project{Name: "X", OwnerID: f.User.ID})
	_ = repo.Save(ctx, &model.Project{Name: "Y", OwnerID: f.User.ID})

	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 3 { // 2 new + 1 from fixture
		t.Errorf("FindAll: want 3, got %d", len(all))
	}
}

func TestProjectRepo_Update(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProjectRepository(testPool)

	p := &model.Project{Name: "Before", OwnerID: f.User.ID}
	_ = repo.Save(ctx, p)

	p.Name = "After"
	p.Description = "updated"
	if err := repo.Update(ctx, p); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, p.ID)
	if got.Name != "After" || got.Description != "updated" {
		t.Errorf("Update: want Name='After', got %+v", got)
	}
}

func TestProjectRepo_Delete(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProjectRepository(testPool)

	p := &model.Project{Name: "ToDelete", OwnerID: f.User.ID}
	_ = repo.Save(ctx, p)

	if err := repo.Delete(ctx, p.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := repo.FindByID(ctx, p.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
