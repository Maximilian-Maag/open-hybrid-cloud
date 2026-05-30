// Package notification enthält den SMTP-basierten Benachrichtigungsdienst.
package notification

import (
	"context"

	"github.com/porr-ag/infra-webshop/internal/config"
	"github.com/porr-ag/infra-webshop/internal/model"
)

type Service struct {
	cfg *config.Config
}

func NewService(cfg *config.Config) *Service {
	return &Service{cfg: cfg}
}

// OrderStatusChanged sends an email notification when an order status changes.
func (s *Service) OrderStatusChanged(ctx context.Context, order *model.Order, recipient *model.User) error {
	// TODO: implement SMTP notification via cfg.SMTPHost
	return nil
}
