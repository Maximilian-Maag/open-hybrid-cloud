// Package polling enthält den Hintergrund-Worker für GitLab Pipeline-Status-Polling.
package polling

import (
	"context"
	"log/slog"

	"github.com/porr-ag/infra-webshop/internal/repository"
)

// Worker polls active GitLab pipelines and updates order/infrastructure status in the DB.
// Uses PostgreSQL advisory locks to run safely across multiple replicas.
type Worker struct {
	orders repository.OrderRepository
	infra  repository.InfrastructureRepository
}

func NewWorker(orders repository.OrderRepository, infra repository.InfrastructureRepository) *Worker {
	return &Worker{orders: orders, infra: infra}
}

// Run starts the polling loop and blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	slog.Info("polling worker started")
	// TODO: implement GitLab pipeline polling with DB advisory locking
	<-ctx.Done()
	slog.Info("polling worker stopped")
}
