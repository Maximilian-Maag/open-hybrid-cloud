package postgres

import (
	"context"
	"testing"
)

func TestExchangeRateRepo_LoadAllEmpty(t *testing.T) {
	resetDB(t)
	rates, err := NewExchangeRateRepository(testPool).LoadAll(context.Background())
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(rates) != 0 {
		t.Errorf("LoadAll empty: want 0 rates, got %d", len(rates))
	}
}

func TestExchangeRateRepo_SaveAllAndLoadAll(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewExchangeRateRepository(testPool)

	want := map[string]float64{
		"USD": 1.10,
		"CHF": 0.95,
		"GBP": 0.85,
	}
	if err := repo.SaveAll(ctx, want); err != nil {
		t.Fatalf("SaveAll: %v", err)
	}

	got, err := repo.LoadAll(ctx)
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got) != 3 {
		t.Errorf("LoadAll: want 3 rates, got %d", len(got))
	}
	if got["USD"] != 1.10 {
		t.Errorf("USD rate: want 1.10, got %v", got["USD"])
	}
}

func TestExchangeRateRepo_Upsert(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewExchangeRateRepository(testPool)

	_ = repo.SaveAll(ctx, map[string]float64{"USD": 1.00})
	_ = repo.SaveAll(ctx, map[string]float64{"USD": 1.20})

	got, _ := repo.LoadAll(ctx)
	if got["USD"] != 1.20 {
		t.Errorf("Upsert: want USD=1.20, got %v", got["USD"])
	}
}
