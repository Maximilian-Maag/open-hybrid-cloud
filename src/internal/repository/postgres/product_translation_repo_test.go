package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestProductTranslationRepo_UpsertAndFindByProductID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductTranslationRepository(testPool)

	tr := &model.ProductTranslation{
		ProductID:    f.Product.ID,
		LanguageCode: "de",
		Name:         "Mein Produkt",
		Description:  "Beschreibung",
	}
	if err := repo.Upsert(ctx, tr); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	list, err := repo.FindByProductID(ctx, f.Product.ID)
	if err != nil {
		t.Fatalf("FindByProductID: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("FindByProductID: want 1, got %d", len(list))
	}
	if list[0].Name != "Mein Produkt" {
		t.Errorf("Name: want 'Mein Produkt', got %q", list[0].Name)
	}
}

func TestProductTranslationRepo_FindByProductAndLang(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductTranslationRepository(testPool)

	_ = repo.Upsert(ctx, &model.ProductTranslation{ProductID: f.Product.ID, LanguageCode: "de", Name: "Deutsch", Description: "DE"})
	_ = repo.Upsert(ctx, &model.ProductTranslation{ProductID: f.Product.ID, LanguageCode: "en", Name: "English", Description: "EN"})

	got, err := repo.FindByProductAndLang(ctx, f.Product.ID, "en")
	if err != nil {
		t.Fatalf("FindByProductAndLang: %v", err)
	}
	if got == nil || got.Name != "English" {
		t.Errorf("FindByProductAndLang: want Name='English', got %v", got)
	}
}

func TestProductTranslationRepo_FindByProductAndLang_notFound(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	got, err := NewProductTranslationRepository(testPool).FindByProductAndLang(context.Background(), f.Product.ID, "fr")
	if err != nil {
		t.Fatalf("FindByProductAndLang: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByProductAndLang: want nil for missing lang, got %+v", got)
	}
}

func TestProductTranslationRepo_UpsertUpdates(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductTranslationRepository(testPool)

	_ = repo.Upsert(ctx, &model.ProductTranslation{ProductID: f.Product.ID, LanguageCode: "de", Name: "Alt", Description: "Alte Beschreibung"})
	_ = repo.Upsert(ctx, &model.ProductTranslation{ProductID: f.Product.ID, LanguageCode: "de", Name: "Neu", Description: "Neue Beschreibung"})

	got, _ := repo.FindByProductAndLang(ctx, f.Product.ID, "de")
	if got.Name != "Neu" {
		t.Errorf("Upsert update: want Name='Neu', got %q", got.Name)
	}
}
