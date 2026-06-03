package notification

import (
	"context"
	"testing"

	"github.com/porr-ag/infra-webshop/src/internal/config"
	"github.com/porr-ag/infra-webshop/src/internal/model"
)

func TestOrderCreated_positive_noSMTP(t *testing.T) {
	// SMTPHost is empty → sendHTML returns nil silently; no real SMTP needed.
	cfg := &config.Config{SMTPHost: "", SMTPFrom: ""}
	svc := NewService(cfg, nil)

	o := &model.Order{ID: 1, ProductID: 2}
	if err := svc.OrderCreated(context.Background(), o, "user@example.com", false); err != nil {
		t.Errorf("OrderCreated with empty SMTP: want nil, got %v", err)
	}
}

func TestOrderCreated_negative_unreachableSMTP(t *testing.T) {
	// Port 1 on localhost is reserved/refused — dial will fail immediately.
	cfg := &config.Config{
		SMTPHost: "127.0.0.1",
		SMTPPort: "1",
		SMTPFrom: "noreply@test.local",
	}
	svc := NewService(cfg, nil)

	o := &model.Order{ID: 1, ProductID: 2}
	err := svc.OrderCreated(context.Background(), o, "user@example.com", false)
	if err == nil {
		t.Error("OrderCreated with unreachable SMTP: expected connection error, got nil")
	}
}
