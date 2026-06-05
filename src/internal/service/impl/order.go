package impl

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/gitlab"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/repository"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/service"
)

var projectIDReOrder = regexp.MustCompile(`/projects/(\d+)/`)

type orderService struct {
	orders     repository.OrderRepository
	infra      repository.InfrastructureRepository
	envs       repository.EnvironmentRepository
	sources    repository.GitLabSourceRepository
	webhooks   repository.ProductWebhookRepository
	audit      service.AuditService
	httpClient *http.Client
}

func NewOrderService(
	orders repository.OrderRepository,
	infra repository.InfrastructureRepository,
	envs repository.EnvironmentRepository,
	sources repository.GitLabSourceRepository,
	webhooks repository.ProductWebhookRepository,
	audit service.AuditService,
) service.OrderService {
	return &orderService{
		orders:     orders,
		infra:      infra,
		envs:       envs,
		sources:    sources,
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

	glClient := s.gitlabClientFor(ctx, env)

	productWebhooks, _ := s.webhooks.FindByProductAndEnv(ctx, o.ProductID, o.EnvironmentID)
	if len(productWebhooks) == 0 {
		pid, err := fireWebhook(ctx, s.httpClient, env.WebhookURL, env.WebhookToken, vars)
		if err != nil {
			return err
		}
		pid = s.resolvePipelineID(ctx, pid, glClient, env.WebhookURL)
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
		pid = s.resolvePipelineID(ctx, pid, glClient, wh.WebhookURL)
		if pid != "" {
			_ = s.orders.AppendPipelineID(ctx, o.ID, pid)
		}
	}
	return nil
}

// gitlabClientFor returns a GitLab client for the environment's source.
func (s *orderService) gitlabClientFor(ctx context.Context, env *model.DeploymentEnvironment) *gitlab.Client {
	if env.GitLabSourceID == 0 {
		return nil
	}
	src, err := s.sources.FindByID(ctx, env.GitLabSourceID)
	if err != nil || src == nil {
		return nil
	}
	return gitlab.NewClient(src.URL, src.AccessToken)
}

// resolvePipelineID returns pid if non-empty, otherwise falls back to the latest trigger pipeline via the GitLab API.
func (s *orderService) resolvePipelineID(ctx context.Context, pid string, client *gitlab.Client, webhookURL string) string {
	if pid != "" {
		return pid
	}
	if client == nil {
		return ""
	}
	projectID, err := extractProjectID(webhookURL)
	if err != nil {
		return ""
	}
	latestID, err := client.GetLatestTriggerPipeline(ctx, projectID)
	if err != nil {
		slog.Warn("order: fallback pipeline lookup failed", "err", err)
		return ""
	}
	slog.Info("order: resolved pipeline ID via API fallback", "pipeline_id", latestID)
	return strconv.FormatInt(latestID, 10)
}

func extractProjectID(webhookURL string) (int64, error) {
	// reuse the same regex logic from polling
	m := projectIDReOrder.FindStringSubmatch(webhookURL)
	if len(m) < 2 {
		return 0, fmt.Errorf("no project ID in webhook URL: %s", webhookURL)
	}
	return strconv.ParseInt(m[1], 10, 64)
}
