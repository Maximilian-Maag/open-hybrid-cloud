package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestAppConfigRepo_LoadDefault(t *testing.T) {
	resetDB(t)
	cfg, err := NewAppConfigRepository(testPool).Load(context.Background())
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg == nil {
		t.Fatal("Load: expected non-nil AppConfig for empty table")
	}
}

func TestAppConfigRepo_SaveAndLoad(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewAppConfigRepository(testPool)

	want := &model.AppConfig{
		SMTPHost:    "smtp.example.com",
		SMTPPort:    "587",
		SMTPFrom:    "noreply@example.com",
		SMTPUsername: "user",
		SMTPPassword: "pass",
		SMTPTLS:     true,
		AIProvider:  "claude",
		AIModel:     "claude-haiku-4-5-20251001",
	}
	if err := repo.Save(ctx, want); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := repo.Load(ctx)
	if err != nil {
		t.Fatalf("Load after Save: %v", err)
	}
	if got.SMTPHost != want.SMTPHost {
		t.Errorf("SMTPHost: want %q, got %q", want.SMTPHost, got.SMTPHost)
	}
	if got.AIModel != want.AIModel {
		t.Errorf("AIModel: want %q, got %q", want.AIModel, got.AIModel)
	}
	if !got.SMTPTLS {
		t.Error("SMTPTLS: want true, got false")
	}
}

func TestAppConfigRepo_Upsert(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewAppConfigRepository(testPool)

	_ = repo.Save(ctx, &model.AppConfig{SMTPHost: "first.example.com"})
	_ = repo.Save(ctx, &model.AppConfig{SMTPHost: "second.example.com"})

	got, _ := repo.Load(ctx)
	if got.SMTPHost != "second.example.com" {
		t.Errorf("Upsert: want 'second.example.com', got %q", got.SMTPHost)
	}
}
