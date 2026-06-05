package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestProductEnvRepo_UpsertAndFindByProductID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductEnvironmentRepository(testPool)

	pe := &model.ProductEnvironment{
		ProductID:      f.Product.ID,
		EnvironmentID:  f.Env.ID,
		Price:          9.99,
		Currency:       "EUR",
		CostCenterMode: model.CostCenterModeProject,
	}
	if err := repo.Upsert(ctx, pe); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	list, err := repo.FindByProductID(ctx, f.Product.ID)
	if err != nil {
		t.Fatalf("FindByProductID: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("FindByProductID: want 1, got %d", len(list))
	}
	if list[0].Price != 9.99 {
		t.Errorf("Price: want 9.99, got %v", list[0].Price)
	}
}

func TestProductEnvRepo_FindByProductAndEnv(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductEnvironmentRepository(testPool)

	pe := &model.ProductEnvironment{
		ProductID:      f.Product.ID,
		EnvironmentID:  f.Env.ID,
		Price:          5.00,
		Currency:       "USD",
		CostCenterMode: model.CostCenterModeOverhead,
	}
	_ = repo.Upsert(ctx, pe)

	got, err := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if err != nil {
		t.Fatalf("FindByProductAndEnv: %v", err)
	}
	if got == nil {
		t.Fatal("FindByProductAndEnv: want result, got nil")
	}
	if got.Currency != "USD" {
		t.Errorf("Currency: want 'USD', got %q", got.Currency)
	}
}

func TestProductEnvRepo_FindByProductAndEnv_notFound(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	got, err := NewProductEnvironmentRepository(testPool).FindByProductAndEnv(context.Background(), f.Product.ID, 9999)
	if err != nil {
		t.Fatalf("FindByProductAndEnv: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByProductAndEnv: want nil for unknown combo, got %+v", got)
	}
}

func TestProductEnvRepo_UpsertUpdates(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductEnvironmentRepository(testPool)

	pe := &model.ProductEnvironment{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Price: 1.00, Currency: "EUR", CostCenterMode: model.CostCenterModeProject}
	_ = repo.Upsert(ctx, pe)

	pe.Price = 2.00
	pe.Currency = "CHF"
	_ = repo.Upsert(ctx, pe)

	got, _ := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if got.Price != 2.00 || got.Currency != "CHF" {
		t.Errorf("Upsert update: want Price=2.00 Currency='CHF', got %+v", got)
	}
}

func TestProductEnvRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductEnvironmentRepository(testPool)

	pe := &model.ProductEnvironment{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Price: 1.00, Currency: "EUR", CostCenterMode: model.CostCenterModeProject}
	_ = repo.Upsert(ctx, pe)

	if err := repo.Delete(ctx, f.Product.ID, f.Env.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, _ := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
