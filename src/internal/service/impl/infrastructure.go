package impl

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service"
)

type infrastructureService struct {
	infra      repository.InfrastructureRepository
	envs       repository.EnvironmentRepository
	webhooks   repository.ProductWebhookRepository
	audit      service.AuditService
	httpClient *http.Client
}

func NewInfrastructureService(
	infra repository.InfrastructureRepository,
	envs repository.EnvironmentRepository,
	webhooks repository.ProductWebhookRepository,
	audit service.AuditService,
) service.InfrastructureService {
	return &infrastructureService{infra, envs, webhooks, audit, &http.Client{}}
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

func (s *infrastructureService) FindByOrderID(ctx context.Context, orderID int64) (*model.InfrastructureElement, error) {
	return s.infra.FindByOrderID(ctx, orderID)
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
	if err := s.triggerDestroyWebhook(ctx, el, env); err != nil {
		return fmt.Errorf("trigger destroy webhook: %w", err)
	}
	if err := s.infra.UpdateStatus(ctx, elementID, model.OrderStatusDecommissioning); err != nil {
		return err
	}
	_ = s.audit.Log(ctx, &model.AuditEntry{
		UserID: userID, Action: model.AuditActionDecommissioned, EntityID: elementID,
	})
	return nil
}

func (s *infrastructureService) DecommissionByProject(ctx context.Context, projectID, userID int64) error {
	elements, err := s.infra.FindByProjectID(ctx, projectID)
	if err != nil {
		return err
	}
	return s.decommissionActive(ctx, elements, userID)
}

func (s *infrastructureService) DecommissionByProduct(ctx context.Context, productID, userID int64) error {
	elements, err := s.infra.FindByProductID(ctx, productID)
	if err != nil {
		return err
	}
	return s.decommissionActive(ctx, elements, userID)
}

func (s *infrastructureService) decommissionActive(ctx context.Context, elements []model.InfrastructureElement, userID int64) error {
	for _, el := range elements {
		switch el.Status {
		case model.OrderStatusDecommissioning, model.OrderStatusDecommissioned:
			continue
		default:
		}
		if err := s.Decommission(ctx, el.ID, userID); err != nil {
			return err
		}
	}
	return nil
}

// triggerDestroyWebhook fires the destroy pipeline(s) with TF_ACTION=destroy and INFRA_ID set.
// Pipeline IDs are appended to the infra element's pipeline_id array.
func (s *infrastructureService) triggerDestroyWebhook(ctx context.Context, el *model.InfrastructureElement, env *model.DeploymentEnvironment) error {
	vars := buildVars(el.Parameters, "INFRA_ID", strconv.FormatInt(el.ID, 10))
	vars = append(vars, map[string]string{"key": "TF_ACTION", "value": "destroy"})

	productWebhooks, _ := s.webhooks.FindByProductAndEnv(ctx, el.ProductID, el.EnvironmentID)
	if len(productWebhooks) == 0 {
		pid, err := fireWebhook(ctx, s.httpClient, env.WebhookURL, env.WebhookToken, vars)
		if err != nil {
			return err
		}
		if pid != "" {
			_ = s.infra.AppendPipelineID(ctx, el.ID, pid)
		}
		return nil
	}

	for _, wh := range productWebhooks {
		pid, err := fireWebhook(ctx, s.httpClient, wh.WebhookURL, wh.WebhookToken, vars)
		if err != nil {
			return fmt.Errorf("webhook %s: %w", wh.Name, err)
		}
		if pid != "" {
			_ = s.infra.AppendPipelineID(ctx, el.ID, pid)
		}
	}
	return nil
}
