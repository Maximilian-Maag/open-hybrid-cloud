package polling

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/porr-ag/infra-webshop/internal/gitlab"
	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/notification"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

var projectIDRe = regexp.MustCompile(`/projects/(\d+)/`)

// Worker polls active GitLab pipelines and updates order/infrastructure status.
// PostgreSQL advisory locks prevent concurrent polling across multiple replicas.
type Worker struct {
	orders   repository.OrderRepository
	infra    repository.InfrastructureRepository
	envs     repository.EnvironmentRepository
	sources  repository.GitLabSourceRepository
	users    repository.UserRepository
	webhooks repository.ProductWebhookRepository
	notifier *notification.Service
	pool     *pgxpool.Pool
}

func NewWorker(
	orders repository.OrderRepository,
	infra repository.InfrastructureRepository,
	envs repository.EnvironmentRepository,
	sources repository.GitLabSourceRepository,
	users repository.UserRepository,
	webhooks repository.ProductWebhookRepository,
	notifier *notification.Service,
	pool *pgxpool.Pool,
) *Worker {
	return &Worker{
		orders:   orders,
		infra:    infra,
		envs:     envs,
		sources:  sources,
		users:    users,
		webhooks: webhooks,
		notifier: notifier,
		pool:     pool,
	}
}

func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	slog.Info("polling worker started")
	for {
		select {
		case <-ctx.Done():
			slog.Info("polling worker stopped")
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	var locked bool
	if err := w.pool.QueryRow(ctx, `SELECT pg_try_advisory_lock(1)`).Scan(&locked); err != nil || !locked {
		return
	}
	defer w.pool.Exec(ctx, `SELECT pg_advisory_unlock(1)`) //nolint:errcheck

	w.pollOrders(ctx)
	w.pollInfra(ctx)
}

func (w *Worker) pollOrders(ctx context.Context) {
	orders, err := w.orders.FindByStatus(ctx, model.OrderStatusProvisioning)
	if err != nil {
		slog.Error("polling: find provisioning orders", "err", err)
		return
	}
	for i := range orders {
		if len(orders[i].PipelineIDs) == 0 {
			continue
		}
		w.pollOrder(ctx, &orders[i])
	}
}

func (w *Worker) pollOrder(ctx context.Context, o *model.Order) {
	client, envWebhookURL, err := w.gitlabClientFor(ctx, o.EnvironmentID)
	if err != nil {
		slog.Warn("polling: gitlab client for order", "order_id", o.ID, "err", err)
		return
	}

	// Resolve per-pipeline webhook URLs: product webhooks override env default.
	webhookURLs := w.resolveWebhookURLs(ctx, o.ProductID, o.EnvironmentID, envWebhookURL, len(o.PipelineIDs))

	anyFailed := false
	allDone := true
	for i, pidStr := range o.PipelineIDs {
		pid, err := strconv.ParseInt(pidStr, 10, 64)
		if err != nil {
			continue
		}
		projectID, err := extractProjectID(webhookURLs[i])
		if err != nil {
			slog.Warn("polling: extract project ID", "order_id", o.ID, "err", err)
			allDone = false
			continue
		}
		pipeline, err := client.GetPipelineStatus(ctx, projectID, pid)
		if err != nil {
			slog.Error("polling: pipeline status", "order_id", o.ID, "pipeline_id", pid, "err", err)
			allDone = false
			continue
		}
		switch pipeline.Status {
		case "success":
			// keep allDone = true
		case "failed", "canceled":
			anyFailed = true
		default:
			allDone = false
		}
	}

	switch {
	case anyFailed:
		_ = w.orders.UpdateStatus(ctx, o.ID, model.OrderStatusFailed)
		w.updateInfraForOrder(ctx, o.ID, model.OrderStatusFailed, nil)
		if email := w.userEmail(ctx, o.UserID); email != "" {
			_ = w.notifier.ProvisioningFailed(ctx, o, email)
		}
	case allDone:
		_ = w.orders.UpdateStatus(ctx, o.ID, model.OrderStatusCompleted)
		outputs := w.fetchOutputs(ctx, client, webhookURLs, o.PipelineIDs)
		w.updateInfraForOrder(ctx, o.ID, model.OrderStatusCompleted, outputs)
		if email := w.userEmail(ctx, o.UserID); email != "" {
			_ = w.notifier.ProvisioningCompleted(ctx, o, email)
		}
	}
}

// fetchOutputs retrieves tofu output values from the apply job trace of the last pipeline.
func (w *Worker) fetchOutputs(ctx context.Context, client *gitlab.Client, webhookURLs []string, pipelineIDs []string) map[string]string {
	if len(pipelineIDs) == 0 || len(webhookURLs) == 0 {
		return nil
	}
	pid, err := strconv.ParseInt(pipelineIDs[len(pipelineIDs)-1], 10, 64)
	if err != nil {
		return nil
	}
	projectID, err := extractProjectID(webhookURLs[len(webhookURLs)-1])
	if err != nil {
		return nil
	}
	jobs, err := client.GetPipelineJobs(ctx, projectID, pid)
	if err != nil {
		slog.Warn("polling: get pipeline jobs", "err", err)
		return nil
	}
	for _, job := range jobs {
		if job.Name != "apply" {
			continue
		}
		trace, err := client.GetJobTrace(ctx, projectID, job.ID)
		if err != nil {
			slog.Warn("polling: get job trace", "job_id", job.ID, "err", err)
			return nil
		}
		outputs := gitlab.ParseTofuOutputs(trace)
		slog.Info("polling: parsed outputs", "job_id", job.ID, "outputs", outputs)
		return outputs
	}
	return nil
}

func (w *Worker) updateInfraForOrder(ctx context.Context, orderID int64, status model.OrderStatus, outputs map[string]string) {
	els, err := w.infra.FindByStatuses(ctx, []model.OrderStatus{model.OrderStatusProvisioning})
	if err != nil {
		return
	}
	for _, el := range els {
		if el.OrderID == orderID {
			_ = w.infra.UpdateStatus(ctx, el.ID, status)
			if len(outputs) > 0 {
				_ = w.infra.UpdateOutputs(ctx, el.ID, outputs)
			}
			return
		}
	}
}

func (w *Worker) pollInfra(ctx context.Context) {
	elements, err := w.infra.FindByStatuses(ctx, []model.OrderStatus{model.OrderStatusDecommissioning})
	if err != nil {
		slog.Error("polling: find decommissioning infra", "err", err)
		return
	}
	for i := range elements {
		if len(elements[i].PipelineIDs) == 0 {
			continue
		}
		w.pollInfraElement(ctx, &elements[i])
	}
}

func (w *Worker) pollInfraElement(ctx context.Context, el *model.InfrastructureElement) {
	client, envWebhookURL, err := w.gitlabClientFor(ctx, el.EnvironmentID)
	if err != nil {
		slog.Warn("polling: gitlab client for infra", "infra_id", el.ID, "err", err)
		return
	}

	webhookURLs := w.resolveWebhookURLs(ctx, el.ProductID, el.EnvironmentID, envWebhookURL, len(el.PipelineIDs))

	anyFailed := false
	allDone := true
	for i, pidStr := range el.PipelineIDs {
		pid, err := strconv.ParseInt(pidStr, 10, 64)
		if err != nil {
			continue
		}
		projectID, err := extractProjectID(webhookURLs[i])
		if err != nil {
			slog.Warn("polling: extract infra project ID", "infra_id", el.ID, "err", err)
			allDone = false
			continue
		}
		pipeline, err := client.GetPipelineStatus(ctx, projectID, pid)
		if err != nil {
			slog.Error("polling: infra pipeline status", "infra_id", el.ID, "pipeline_id", pid, "err", err)
			allDone = false
			continue
		}
		switch pipeline.Status {
		case "success":
			// keep allDone = true
		case "failed", "canceled":
			anyFailed = true
		default:
			allDone = false
		}
	}

	switch {
	case anyFailed:
		_ = w.infra.UpdateStatus(ctx, el.ID, model.OrderStatusFailed)
	case allDone:
		_ = w.infra.UpdateStatus(ctx, el.ID, model.OrderStatusDecommissioned)
		if o, err := w.orders.FindByID(ctx, el.OrderID); err == nil && o != nil {
			if email := w.userEmail(ctx, o.UserID); email != "" {
				_ = w.notifier.Decommissioned(ctx, el.ID, email)
			}
		}
	}
}

// gitlabClientFor returns a GitLab client for the given environment plus the env's webhook URL
// (used as a fallback project ID source when no product webhooks exist).
func (w *Worker) gitlabClientFor(ctx context.Context, envID int64) (*gitlab.Client, string, error) {
	env, err := w.envs.FindByID(ctx, envID)
	if err != nil || env == nil {
		return nil, "", fmt.Errorf("environment %d not found", envID)
	}
	source, err := w.sources.FindByID(ctx, env.GitLabSourceID)
	if err != nil || source == nil {
		return nil, "", fmt.Errorf("gitlab source %d not found", env.GitLabSourceID)
	}
	return gitlab.NewClient(source.URL, source.AccessToken), env.WebhookURL, nil
}

// resolveWebhookURLs returns one webhook URL per pipeline ID slot.
// If product webhooks are defined, their URLs are used in exec_order sequence.
// The environment fallback URL fills any remaining or all slots.
func (w *Worker) resolveWebhookURLs(ctx context.Context, productID, envID int64, fallbackURL string, count int) []string {
	urls := make([]string, count)
	for i := range urls {
		urls[i] = fallbackURL
	}
	pws, err := w.webhooks.FindByProductAndEnv(ctx, productID, envID)
	if err != nil {
		return urls
	}
	for i, pw := range pws {
		if i < count {
			urls[i] = pw.WebhookURL
		}
	}
	return urls
}

func (w *Worker) userEmail(ctx context.Context, userID int64) string {
	u, err := w.users.FindByID(ctx, userID)
	if err != nil || u == nil {
		return ""
	}
	return u.Email
}

func extractProjectID(webhookURL string) (int64, error) {
	m := projectIDRe.FindStringSubmatch(webhookURL)
	if len(m) < 2 {
		return 0, fmt.Errorf("no project ID in webhook URL: %s", webhookURL)
	}
	return strconv.ParseInt(m[1], 10, 64)
}
