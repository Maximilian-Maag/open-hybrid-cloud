package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestGitLabSourceRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewGitLabSourceRepository(testPool)

	s := &model.GitLabSource{Name: "My GitLab", URL: "https://gitlab.example.com", AccessToken: "secret"}
	if err := repo.Save(ctx, s); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if s.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, s.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Name != "My GitLab" {
		t.Errorf("FindByID: want Name='My GitLab', got %v", got)
	}
	if got.AccessToken != "secret" {
		t.Errorf("FindByID: want AccessToken='secret', got %q", got.AccessToken)
	}
}

func TestGitLabSourceRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewGitLabSourceRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestGitLabSourceRepo_FindAll(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewGitLabSourceRepository(testPool)

	_ = repo.Save(ctx, &model.GitLabSource{Name: "Alpha", URL: "https://a.example.com", AccessToken: "t"})
	_ = repo.Save(ctx, &model.GitLabSource{Name: "Beta", URL: "https://b.example.com", AccessToken: "t"})

	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("FindAll: want 2, got %d", len(all))
	}
}

func TestGitLabSourceRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewGitLabSourceRepository(testPool)

	s := &model.GitLabSource{Name: "Old", URL: "https://old.example.com", AccessToken: "tok1"}
	_ = repo.Save(ctx, s)

	s.Name = "New"
	s.URL = "https://new.example.com"
	s.AccessToken = "tok2"
	if err := repo.Update(ctx, s); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, s.ID)
	if got.Name != "New" || got.URL != "https://new.example.com" {
		t.Errorf("Update: want Name='New', got %+v", got)
	}
}

func TestGitLabSourceRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewGitLabSourceRepository(testPool)

	s := &model.GitLabSource{Name: "ToDelete", URL: "https://del.example.com", AccessToken: "tok"}
	_ = repo.Save(ctx, s)

	if err := repo.Delete(ctx, s.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := repo.FindByID(ctx, s.ID)
	if got != nil {
		t.Errorf("Delete: expected nil, got %+v", got)
	}
}
