package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestEnvironmentRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	srcRepo := NewGitLabSourceRepository(testPool)
	envRepo := NewEnvironmentRepository(testPool)

	src := &model.GitLabSource{Name: "src", URL: "https://gitlab.example.com", AccessToken: "tok"}
	_ = srcRepo.Save(ctx, src)

	env := &model.DeploymentEnvironment{
		Name:           "Production",
		Description:    "Prod env",
		GitLabSourceID: src.ID,
		WebhookURL:     "https://gitlab.example.com/projects/1/trigger/pipeline",
		WebhookToken:   "wtoken",
	}
	if err := envRepo.Save(ctx, env); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if env.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := envRepo.FindByID(ctx, env.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Name != "Production" {
		t.Errorf("FindByID: want Name='Production', got %v", got)
	}
	if got.Description != "Prod env" {
		t.Errorf("FindByID: want Description='Prod env', got %q", got.Description)
	}
}

func TestEnvironmentRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewEnvironmentRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestEnvironmentRepo_FindAll(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	srcRepo := NewGitLabSourceRepository(testPool)
	envRepo := NewEnvironmentRepository(testPool)

	src := &model.GitLabSource{Name: "src2", URL: "https://gl2.example.com", AccessToken: "tok"}
	_ = srcRepo.Save(ctx, src)

	_ = envRepo.Save(ctx, &model.DeploymentEnvironment{Name: "Env A", GitLabSourceID: src.ID, WebhookURL: "https://x.com/1", WebhookToken: "t"})
	_ = envRepo.Save(ctx, &model.DeploymentEnvironment{Name: "Env B", GitLabSourceID: src.ID, WebhookURL: "https://x.com/2", WebhookToken: "t"})

	all, err := envRepo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("FindAll: want 2, got %d", len(all))
	}
}

func TestEnvironmentRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	srcRepo := NewGitLabSourceRepository(testPool)
	envRepo := NewEnvironmentRepository(testPool)

	src := &model.GitLabSource{Name: "src3", URL: "https://gl3.example.com", AccessToken: "tok"}
	_ = srcRepo.Save(ctx, src)

	env := &model.DeploymentEnvironment{Name: "Old", GitLabSourceID: src.ID, WebhookURL: "https://x.com/3", WebhookToken: "t"}
	_ = envRepo.Save(ctx, env)

	env.Name = "New"
	env.Description = "Updated"
	if err := envRepo.Update(ctx, env); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := envRepo.FindByID(ctx, env.ID)
	if got.Name != "New" || got.Description != "Updated" {
		t.Errorf("Update: want Name='New' Description='Updated', got %+v", got)
	}
}

func TestEnvironmentRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	srcRepo := NewGitLabSourceRepository(testPool)
	envRepo := NewEnvironmentRepository(testPool)

	src := &model.GitLabSource{Name: "src4", URL: "https://gl4.example.com", AccessToken: "tok"}
	_ = srcRepo.Save(ctx, src)

	env := &model.DeploymentEnvironment{Name: "ToDelete", GitLabSourceID: src.ID, WebhookURL: "https://x.com/4", WebhookToken: "t"}
	_ = envRepo.Save(ctx, env)

	if err := envRepo.Delete(ctx, env.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := envRepo.FindByID(ctx, env.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
