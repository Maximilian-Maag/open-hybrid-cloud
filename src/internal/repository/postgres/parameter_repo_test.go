package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestParameterRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewParameterRepository(testPool)

	p := &model.Parameter{
		Scope:        model.ParameterScopeProduct,
		ScopeID:      f.Product.ID,
		EnvironmentID: 0,
		Name:         "cpu_count",
		Type:         model.ParameterTypeNumber,
		Description:  "Number of CPUs",
		DefaultValue: "4",
		Required:     true,
		Sensitive:    false,
	}
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
	if got == nil || got.Name != "cpu_count" {
		t.Errorf("FindByID: want Name='cpu_count', got %v", got)
	}
	if got.DefaultValue != "4" {
		t.Errorf("FindByID: want DefaultValue='4', got %q", got.DefaultValue)
	}
}

func TestParameterRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewParameterRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestParameterRepo_FindByScope(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewParameterRepository(testPool)

	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, Name: "p1", Type: model.ParameterTypeString})
	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, Name: "p2", Type: model.ParameterTypeString})
	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeGlobal, ScopeID: 0, Name: "global1", Type: model.ParameterTypeString})

	params, err := repo.FindByScope(ctx, model.ParameterScopeProduct, f.Product.ID)
	if err != nil {
		t.Fatalf("FindByScope: %v", err)
	}
	if len(params) != 2 {
		t.Errorf("FindByScope: want 2, got %d", len(params))
	}
}

func TestParameterRepo_FindByScopeAndEnv(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewParameterRepository(testPool)

	// global (env=0) should always be included; env-specific only for matching env
	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, EnvironmentID: 0, Name: "global", Type: model.ParameterTypeString})
	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, EnvironmentID: f.Env.ID, Name: "env-specific", Type: model.ParameterTypeString})
	_ = repo.Save(ctx, &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, EnvironmentID: 9999, Name: "other-env", Type: model.ParameterTypeString})

	params, err := repo.FindByScopeAndEnv(ctx, model.ParameterScopeProduct, f.Product.ID, f.Env.ID)
	if err != nil {
		t.Fatalf("FindByScopeAndEnv: %v", err)
	}
	if len(params) != 2 {
		t.Errorf("FindByScopeAndEnv: want 2 (global + env-specific), got %d", len(params))
	}
}

func TestParameterRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewParameterRepository(testPool)

	p := &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, Name: "old", Type: model.ParameterTypeString}
	_ = repo.Save(ctx, p)

	p.Name = "updated"
	p.DefaultValue = "new-default"
	p.Required = true
	if err := repo.Update(ctx, p); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, p.ID)
	if got.Name != "updated" || got.DefaultValue != "new-default" || !got.Required {
		t.Errorf("Update: unexpected values: %+v", got)
	}
}

func TestParameterRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewParameterRepository(testPool)

	p := &model.Parameter{Scope: model.ParameterScopeProduct, ScopeID: f.Product.ID, Name: "to-delete", Type: model.ParameterTypeString}
	_ = repo.Save(ctx, p)

	if err := repo.Delete(ctx, p.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := repo.FindByID(ctx, p.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
