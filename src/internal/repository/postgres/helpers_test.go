package postgres

import (
	"context"
	"fmt"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

// fixture creates a complete set of prerequisite records (source → env → user → category → product → project)
// and returns them for use in tests that require FK dependencies.
type fixture struct {
	Source   *model.GitLabSource
	Env      *model.DeploymentEnvironment
	User     *model.User
	Category *model.Category
	Product  *model.Product
	Project  *model.Project
}

var fixtureSeq int

func newFixture(t *testing.T) *fixture {
	t.Helper()
	fixtureSeq++
	seq := fixtureSeq
	ctx := context.Background()

	src := &model.GitLabSource{
		Name:        fmt.Sprintf("source-%d", seq),
		URL:         fmt.Sprintf("https://gitlab%d.example.com", seq),
		AccessToken: "token",
	}
	if err := NewGitLabSourceRepository(testPool).Save(ctx, src); err != nil {
		t.Fatalf("fixture: save gitlab source: %v", err)
	}

	env := &model.DeploymentEnvironment{
		Name:           fmt.Sprintf("env-%d", seq),
		GitLabSourceID: src.ID,
		WebhookURL:     fmt.Sprintf("https://gitlab%d.example.com/projects/1/trigger/pipeline", seq),
		WebhookToken:   "webhook-token",
	}
	if err := NewEnvironmentRepository(testPool).Save(ctx, env); err != nil {
		t.Fatalf("fixture: save environment: %v", err)
	}

	user := &model.User{
		Email:  fmt.Sprintf("user%d@example.com", seq),
		Name:   fmt.Sprintf("User %d", seq),
		Role:   model.RoleAdmin,
		SSOSub: fmt.Sprintf("sso-sub-%d", seq),
	}
	if err := NewUserRepository(testPool).Save(ctx, user); err != nil {
		t.Fatalf("fixture: save user: %v", err)
	}

	cat := &model.Category{Name: fmt.Sprintf("Category %d", seq)}
	if err := NewCategoryRepository(testPool).Save(ctx, cat); err != nil {
		t.Fatalf("fixture: save category: %v", err)
	}

	prod := &model.Product{CategoryID: cat.ID, BaseLanguage: "de"}
	if err := NewProductRepository(testPool).Save(ctx, prod); err != nil {
		t.Fatalf("fixture: save product: %v", err)
	}

	proj := &model.Project{
		Name:    fmt.Sprintf("Project %d", seq),
		OwnerID: user.ID,
	}
	if err := NewProjectRepository(testPool).Save(ctx, proj); err != nil {
		t.Fatalf("fixture: save project: %v", err)
	}

	return &fixture{
		Source:   src,
		Env:      env,
		User:     user,
		Category: cat,
		Product:  prod,
		Project:  proj,
	}
}
