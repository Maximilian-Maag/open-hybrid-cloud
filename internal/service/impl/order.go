package impl

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
)

type orderService struct {
	orders   repository.OrderRepository
	infra    repository.InfrastructureRepository
	envs     repository.EnvironmentRepository
	webhooks repository.ProductWebhookRepository
	audit    service.AuditService
	httpClient *http.Client
}

func NewOrderService(
	orders repository.OrderRepository,
	infra repository.InfrastructureRepository,
	envs repository.EnvironmentRepository,
	webhooks repository.ProductWebhookRepository,
	audit service.AuditService,
) service.OrderService {
	return &orderService{
		orders:     orders,
		infra:      infra,
		envs:       envs,
		webhooks:   webhooks,
		audit:      audit,
		httpClient: &http.Client{},
	}
}

func (s *orderService) Create(ctx context.Context, o *model.Order) error {
	o.Status = model.OrderStatusPendingApproval
	if err := s.orders.Save(ctx, o); err != nil {
		return fmt.Errorf("save order: %w", err)
	}
	_ = s.audit.Log(ctx, &model.AuditEntry{
		UserID: o.UserID, Action: model.AuditActionOrderCreated, EntityID: o.ID,
	})
	return nil
}

func (s *orderService) GetByID(ctx context.Context, id int64) (*model.Order, error) {
	return s.orders.FindByID(ctx, id)
}

func (s *orderService) ListByUser(ctx context.Context, userID int64) ([]model.Order, error) {
	return s.orders.FindByUserID(ctx, userID)
}

func (s *orderService) ListPendingApproval(ctx context.Context) ([]model.Order, error) {
	return s.orders.FindByStatus(ctx, model.OrderStatusPendingApproval)
}

func (s *orderService) Approve(ctx context.Context, orderID, adminID int64) error {
	o, err := s.orders.FindByID(ctx, orderID)
	if err != nil {
		return err
	}
	if o == nil {
		return fmt.Errorf("order %d not found", orderID)
	}
	if err := s.triggerWebhook(ctx, o); err != nil {
		return fmt.Errorf("trigger webhook: %w", err)
	}
	if err := s.orders.UpdateStatus(ctx, orderID, model.OrderStatusProvisioning); err != nil {
		return err
	}
	if err := s.infra.Save(ctx, &model.InfrastructureElement{
		OrderID:       o.ID,
		ProjectID:     o.ProjectID,
		EnvironmentID: o.EnvironmentID,
		ProductID:     o.ProductID,
		Status:        model.OrderStatusProvisioning,
		Parameters:    o.Parameters,
	}); err != nil {
		return fmt.Errorf("save infra element: %w", err)
	}
	_ = s.audit.Log(ctx, &model.AuditEntry{
		UserID: adminID, Action: model.AuditActionOrderApproved, EntityID: orderID,
	})
	return nil
}

func (s *orderService) Reject(ctx context.Context, orderID, adminID int64, note string) error {
	if err := s.orders.UpdateRejection(ctx, orderID, note); err != nil {
		return err
	}
	_ = s.audit.Log(ctx, &model.AuditEntry{
		UserID: adminID, Action: model.AuditActionOrderRejected, EntityID: orderID,
		Details: note,
	})
	return nil
}

// triggerWebhook fires one pipeline per product webhook (if configured) or the environment
// fallback webhook. Each returned pipeline ID is appended to the order's pipeline_id array.
func (s *orderService) triggerWebhook(ctx context.Context, o *model.Order) error {
	env, err := s.envs.FindByID(ctx, o.EnvironmentID)
	if err != nil {
		return err
	}
	if env == nil {
		return fmt.Errorf("environment %d not found", o.EnvironmentID)
	}

	vars := buildVars(o.Parameters, "ORDER_ID", strconv.FormatInt(o.ID, 10))

	productWebhooks, _ := s.webhooks.FindByProductAndEnv(ctx, o.ProductID, o.EnvironmentID)
	if len(productWebhooks) == 0 {
		pid, err := fireWebhook(ctx, s.httpClient, env.WebhookURL, env.WebhookToken, vars)
		if err != nil {
			return err
		}
		if pid != "" {
			_ = s.orders.AppendPipelineID(ctx, o.ID, pid)
		}
		return nil
	}

	for _, wh := range productWebhooks {
		pid, err := fireWebhook(ctx, s.httpClient, wh.WebhookURL, wh.WebhookToken, vars)
		if err != nil {
			return fmt.Errorf("webhook %s: %w", wh.Name, err)
		}
		if pid != "" {
			_ = s.orders.AppendPipelineID(ctx, o.ID, pid)
		}
	}
	return nil
}
