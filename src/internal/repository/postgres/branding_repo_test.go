package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestBrandingRepo_LoadDefault(t *testing.T) {
	resetDB(t)
	b, err := NewBrandingRepository(testPool).Load(context.Background())
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if b == nil {
		t.Fatal("Load: expected non-nil Branding for empty table")
	}
	if b.PrimaryColor == "" {
		t.Error("Load default: expected non-empty PrimaryColor")
	}
}

func TestBrandingRepo_SaveWithoutLogoAndLoad(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewBrandingRepository(testPool)

	want := &model.Branding{
		PrimaryColor:   "#123456",
		SecondaryColor: "#abcdef",
		ShopName:       "Test Shop",
		ShopSubtitle:   "Best Shop",
		ImprintText:    "Imprint here",
	}
	if err := repo.Save(ctx, want); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := repo.Load(ctx)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.PrimaryColor != want.PrimaryColor {
		t.Errorf("PrimaryColor: want %q, got %q", want.PrimaryColor, got.PrimaryColor)
	}
	if got.ShopName != want.ShopName {
		t.Errorf("ShopName: want %q, got %q", want.ShopName, got.ShopName)
	}
}

func TestBrandingRepo_SaveWithLogo(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewBrandingRepository(testPool)

	want := &model.Branding{
		LogoData:       []byte("fake-png-data"),
		LogoMime:       "image/png",
		PrimaryColor:   "#ffffff",
		SecondaryColor: "#000000",
	}
	if err := repo.Save(ctx, want); err != nil {
		t.Fatalf("Save with logo: %v", err)
	}

	got, _ := repo.Load(ctx)
	if string(got.LogoData) != "fake-png-data" {
		t.Errorf("LogoData: want 'fake-png-data', got %q", got.LogoData)
	}
	if got.LogoMime != "image/png" {
		t.Errorf("LogoMime: want 'image/png', got %q", got.LogoMime)
	}
}

func TestBrandingRepo_Upsert(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewBrandingRepository(testPool)

	_ = repo.Save(ctx, &model.Branding{ShopName: "First"})
	_ = repo.Save(ctx, &model.Branding{ShopName: "Second"})

	got, _ := repo.Load(ctx)
	if got.ShopName != "Second" {
		t.Errorf("Upsert: want 'Second', got %q", got.ShopName)
	}
}
