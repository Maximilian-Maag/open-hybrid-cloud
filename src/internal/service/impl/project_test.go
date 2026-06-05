package impl

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
)

type stubProjectRepo struct {
	projects map[int64]*model.Project
	nextID   int64
}

func newStubProjectRepo() *stubProjectRepo {
	return &stubProjectRepo{projects: make(map[int64]*model.Project), nextID: 1}
}

func (r *stubProjectRepo) Save(ctx context.Context, p *model.Project) error {
	r.nextID++
	p.ID = r.nextID
	cp := *p
	r.projects[p.ID] = &cp
	return nil
}
func (r *stubProjectRepo) Update(ctx context.Context, p *model.Project) error {
	cp := *p
	r.projects[p.ID] = &cp
	return nil
}
func (r *stubProjectRepo) FindByID(ctx context.Context, id int64) (*model.Project, error) {
	return r.projects[id], nil
}
func (r *stubProjectRepo) FindByOwnerID(ctx context.Context, ownerID int64) ([]model.Project, error) {
	var out []model.Project
	for _, p := range r.projects {
		if p.OwnerID == ownerID {
			out = append(out, *p)
		}
	}
	return out, nil
}
func (r *stubProjectRepo) FindAll(ctx context.Context) ([]model.Project, error) {
	out := make([]model.Project, 0, len(r.projects))
	for _, p := range r.projects {
		out = append(out, *p)
	}
	return out, nil
}
func (r *stubProjectRepo) Delete(ctx context.Context, id int64) error {
	delete(r.projects, id)
	return nil
}

var _ repository.ProjectRepository = (*stubProjectRepo)(nil)

func TestProjectService_Create_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	p := &model.Project{Name: "MyProject", OwnerID: 1}
	if err := svc.Create(context.Background(), p); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if p.ID == 0 {
		t.Error("expected ID to be set after Create")
	}
}

func TestProjectService_GetByID_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	p := &model.Project{Name: "Alpha", OwnerID: 7}
	_ = svc.Create(context.Background(), p)

	got, err := svc.GetByID(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got == nil || got.Name != "Alpha" {
		t.Errorf("GetByID: want Name='Alpha', got %v", got)
	}
}

func TestProjectService_GetByID_negative_notFound(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	got, err := svc.GetByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("GetByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("GetByID: expected nil for unknown ID, got %+v", got)
	}
}

func TestProjectService_Update_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	p := &model.Project{Name: "Original", OwnerID: 1}
	_ = svc.Create(context.Background(), p)
	p.Name = "Updated"

	if err := svc.Update(context.Background(), p); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, _ := svc.GetByID(context.Background(), p.ID)
	if got == nil || got.Name != "Updated" {
		t.Errorf("Update: want Name='Updated', got %v", got)
	}
}

func TestProjectService_ListByOwner_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	_ = svc.Create(context.Background(), &model.Project{Name: "P1", OwnerID: 42})
	_ = svc.Create(context.Background(), &model.Project{Name: "P2", OwnerID: 42})
	_ = svc.Create(context.Background(), &model.Project{Name: "P3", OwnerID: 99})

	projects, err := svc.ListByOwner(context.Background(), 42)
	if err != nil {
		t.Fatalf("ListByOwner: %v", err)
	}
	if len(projects) != 2 {
		t.Errorf("ListByOwner: want 2 projects for owner 42, got %d", len(projects))
	}
}

func TestProjectService_ListByOwner_emptyForUnknownOwner(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())
	_ = svc.Create(context.Background(), &model.Project{Name: "P1", OwnerID: 1})

	projects, err := svc.ListByOwner(context.Background(), 999)
	if err != nil {
		t.Fatalf("ListByOwner: %v", err)
	}
	if len(projects) != 0 {
		t.Errorf("ListByOwner: want 0 for unknown owner, got %d", len(projects))
	}
}

func TestProjectService_ListAll_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	_ = svc.Create(context.Background(), &model.Project{Name: "A", OwnerID: 1})
	_ = svc.Create(context.Background(), &model.Project{Name: "B", OwnerID: 2})

	all, err := svc.ListAll(context.Background())
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("ListAll: want 2, got %d", len(all))
	}
}

func TestProjectService_Delete_positive(t *testing.T) {
	svc := NewProjectService(newStubProjectRepo())

	p := &model.Project{Name: "ToDelete", OwnerID: 1}
	_ = svc.Create(context.Background(), p)

	if err := svc.Delete(context.Background(), p.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := svc.GetByID(context.Background(), p.ID)
	if got != nil {
		t.Errorf("Delete: expected nil after delete, got %+v", got)
	}
}
