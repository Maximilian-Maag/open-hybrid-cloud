package impl

import (
	"context"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/repository"
	"github.com/porr-ag/infra-webshop/src/internal/service"
)

type projectService struct {
	repo repository.ProjectRepository
}

func NewProjectService(repo repository.ProjectRepository) service.ProjectService {
	return &projectService{repo}
}

func (s *projectService) Create(ctx context.Context, p *model.Project) error {
	return s.repo.Save(ctx, p)
}

func (s *projectService) Update(ctx context.Context, p *model.Project) error {
	return s.repo.Update(ctx, p)
}

func (s *projectService) ListByOwner(ctx context.Context, ownerID int64) ([]model.Project, error) {
	return s.repo.FindByOwnerID(ctx, ownerID)
}

func (s *projectService) ListAll(ctx context.Context) ([]model.Project, error) {
	return s.repo.FindAll(ctx)
}

func (s *projectService) GetByID(ctx context.Context, id int64) (*model.Project, error) {
	return s.repo.FindByID(ctx, id)
}

func (s *projectService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}
