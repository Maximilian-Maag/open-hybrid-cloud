package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestProductWebhookRepo_SaveAndFindByProductAndEnv(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductWebhookRepository(testPool)

	pw := &model.ProductWebhook{
		ProductID:     f.Product.ID,
		EnvironmentID: f.Env.ID,
		Name:          "Deploy Hook",
		WebhookURL:    "https://gitlab.example.com/projects/1/trigger/pipeline",
		WebhookToken:  "token123",
		ExecOrder:     1,
	}
	if err := repo.Save(ctx, pw); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if pw.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	list, err := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if err != nil {
		t.Fatalf("FindByProductAndEnv: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("FindByProductAndEnv: want 1, got %d", len(list))
	}
	if list[0].Name != "Deploy Hook" {
		t.Errorf("Name: want 'Deploy Hook', got %q", list[0].Name)
	}
}

func TestProductWebhookRepo_FindByProductAndEnv_empty(t *testing.T) {
	resetDB(t)
	f := newFixture(t)
	list, err := NewProductWebhookRepository(testPool).FindByProductAndEnv(context.Background(), f.Product.ID, f.Env.ID)
	if err != nil {
		t.Fatalf("FindByProductAndEnv: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("FindByProductAndEnv empty: want 0, got %d", len(list))
	}
}

func TestProductWebhookRepo_ExecOrderPreserved(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductWebhookRepository(testPool)

	_ = repo.Save(ctx, &model.ProductWebhook{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Name: "Third", WebhookURL: "https://x.com/3", WebhookToken: "t", ExecOrder: 3})
	_ = repo.Save(ctx, &model.ProductWebhook{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Name: "First", WebhookURL: "https://x.com/1", WebhookToken: "t", ExecOrder: 1})
	_ = repo.Save(ctx, &model.ProductWebhook{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Name: "Second", WebhookURL: "https://x.com/2", WebhookToken: "t", ExecOrder: 2})

	list, _ := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if len(list) != 3 {
		t.Fatalf("want 3 webhooks, got %d", len(list))
	}
	if list[0].Name != "First" || list[1].Name != "Second" || list[2].Name != "Third" {
		t.Errorf("exec_order not respected: got %v, %v, %v", list[0].Name, list[1].Name, list[2].Name)
	}
}

func TestProductWebhookRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	f := newFixture(t)
	repo := NewProductWebhookRepository(testPool)

	pw := &model.ProductWebhook{ProductID: f.Product.ID, EnvironmentID: f.Env.ID, Name: "ToDelete", WebhookURL: "https://x.com/del", WebhookToken: "t", ExecOrder: 1}
	_ = repo.Save(ctx, pw)

	if err := repo.Delete(ctx, pw.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	list, _ := repo.FindByProductAndEnv(ctx, f.Product.ID, f.Env.ID)
	if len(list) != 0 {
		t.Errorf("Delete: expected 0 webhooks, got %d", len(list))
	}
}
