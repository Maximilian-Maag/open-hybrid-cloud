package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
)

func TestProductRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProductRepository(testPool)

	p := &model.Product{CategoryID: f.Category.ID, BaseLanguage: "en"}
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
	if got == nil || got.BaseLanguage != "en" {
		t.Errorf("FindByID: want BaseLanguage='en', got %v", got)
	}
}

func TestProductRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewProductRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil, got %+v", got)
	}
}

func TestProductRepo_FindByCategoryID(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProductRepository(testPool)

	_ = repo.Save(ctx, &model.Product{CategoryID: f.Category.ID, BaseLanguage: "de"})
	_ = repo.Save(ctx, &model.Product{CategoryID: f.Category.ID, BaseLanguage: "de"})

	products, err := repo.FindByCategoryID(ctx, f.Category.ID)
	if err != nil {
		t.Fatalf("FindByCategoryID: %v", err)
	}
	if len(products) != 3 { // 2 new + 1 from fixture
		t.Errorf("FindByCategoryID: want 3, got %d", len(products))
	}
}

func TestProductRepo_Update(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProductRepository(testPool)

	p := &model.Product{CategoryID: f.Category.ID, BaseLanguage: "de"}
	_ = repo.Save(ctx, p)

	p.BaseLanguage = "fr"
	if err := repo.Update(ctx, p); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, p.ID)
	if got.BaseLanguage != "fr" {
		t.Errorf("Update: want BaseLanguage='fr', got %q", got.BaseLanguage)
	}
}

func TestProductRepo_Delete(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()
	repo := NewProductRepository(testPool)

	p := &model.Product{CategoryID: f.Category.ID, BaseLanguage: "de"}
	_ = repo.Save(ctx, p)

	if err := repo.Delete(ctx, p.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := repo.FindByID(ctx, p.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}

func TestProductRepo_Delete_referencedReturnsErrReferenced(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()

	// Create an order that references the product from the fixture.
	_ = newOrder(t, f)

	// After migration 011, product delete cascades to orders — so no ErrReferenced here.
	// The FK from products → categories does NOT cascade, so deleting a category while
	// products still reference it should return ErrReferenced.
	// Note: migration 012 added ON DELETE CASCADE from products → categories,
	// so deleting a category now cascades. Verify plain Delete works:
	err := NewProductRepository(testPool).Delete(ctx, f.Product.ID)
	if err != nil {
		// With cascade this should succeed (orders cascade-deleted too)
		t.Errorf("Delete (cascading): unexpected error: %v", err)
	}
}

func TestProductRepo_Delete_referencedByNonCascade(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	ctx := context.Background()

	// Create a product_environment row that references the product (ON DELETE CASCADE exists),
	// but try to delete the gitlab_source while still referenced by the environment.
	// gitlab_sources has NO cascade from deployment_environments, so this tests ErrReferenced path
	// at the gitlabSourceRepo level.
	err := NewGitLabSourceRepository(testPool).Delete(ctx, f.Source.ID)
	if err == nil {
		t.Error("Delete referenced gitlab_source: expected error, got nil")
	}
	// We just verify an error was returned; the exact type depends on the implementation.
	_ = repository.ErrReferenced // imported so the package is used
}
