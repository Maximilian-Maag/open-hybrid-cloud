package impl

import (
	"context"
	"fmt"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
)

type infrastructureService struct {
	infra  repository.InfrastructureRepository
	envs   repository.EnvironmentRepository
	audit  service.AuditService
}

func NewInfrastructureService(
	infra repository.InfrastructureRepository,
	envs repository.EnvironmentRepository,
	audit service.AuditService,
) service.InfrastructureService {
	return &infrastructureService{infra, envs, audit}
}

func (s *infrastructureService) ListByProject(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error) {
	return s.infra.FindByProjectID(ctx, projectID)
}

func (s *infrastructureService) ListAll(ctx context.Context) ([]model.InfrastructureElement, error) {
	return s.infra.FindAll(ctx)
}

func (s *infrastructureService) GetByID(ctx context.Context, id int64) (*model.InfrastructureElement, error) {
	return s.infra.FindByID(ctx, id)
}

func (s *infrastructureService) Decommission(ctx context.Context, elementID, userID int64) error {
	el, err := s.infra.FindByID(ctx, elementID)
	if err != nil || el == nil {
		return fmt.Errorf("element not found")
	}
	env, err := s.envs.FindByID(ctx, el.EnvironmentID)
	if err != nil || env == nil {
		return fmt.Errorf("environment not found")
	}
	if err := s.infra.UpdateStatus(ctx, elementID, model.OrderStatusDecommissioning); err != nil {
		return err
	}
	// TODO: trigger GitLab destroy webhook
	_ = s.audit.Log(ctx, &model.AuditEntry{
		UserID: userID, Action: model.AuditActionDecommissioned, EntityID: elementID,
	})
	return nil
}
