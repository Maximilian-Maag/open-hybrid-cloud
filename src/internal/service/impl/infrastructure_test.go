package impl

import (
	"context"
	"testing"

	"github.com/porr-ag/infra-webshop/src/internal/model"
)

func TestInfraService_ListAll_positive(t *testing.T) {
	infraRepo := &stubInfraRepoFull{
		elements: []model.InfrastructureElement{
			{ID: 1, ProjectID: 10, Status: model.OrderStatusCompleted},
			{ID: 2, ProjectID: 10, Status: model.OrderStatusProvisioning},
		},
	}
	svc := NewInfrastructureService(infraRepo, &stubEnvRepo{}, &stubWebhookRepo{}, &stubAudit{})

	els, err := svc.ListAll(context.Background())
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(els) != 2 {
		t.Errorf("ListAll: want 2 elements, got %d", len(els))
	}
}

func TestInfraService_Decommission_negative_notFound(t *testing.T) {
	svc := NewInfrastructureService(&stubInfraRepoFull{}, &stubEnvRepo{}, &stubWebhookRepo{}, &stubAudit{})

	err := svc.Decommission(context.Background(), 999, 1)
	if err == nil {
		t.Error("expected error when decommissioning non-existent element, got nil")
	}
}

// stubInfraRepoFull is a stub that returns pre-loaded elements.
type stubInfraRepoFull struct {
	elements []model.InfrastructureElement
}

func (r *stubInfraRepoFull) FindAll(ctx context.Context) ([]model.InfrastructureElement, error) {
	return r.elements, nil
}
func (r *stubInfraRepoFull) FindByID(ctx context.Context, id int64) (*model.InfrastructureElement, error) {
	for i := range r.elements {
		if r.elements[i].ID == id {
			return &r.elements[i], nil
		}
	}
	return nil, nil
}
func (r *stubInfraRepoFull) FindByProjectID(ctx context.Context, pid int64) ([]model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepoFull) FindByStatuses(ctx context.Context, s []model.OrderStatus) ([]model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepoFull) Save(ctx context.Context, el *model.InfrastructureElement) error {
	return nil
}
func (r *stubInfraRepoFull) UpdateStatus(ctx context.Context, id int64, s model.OrderStatus) error {
	return nil
}
func (r *stubInfraRepoFull) AppendPipelineID(ctx context.Context, id int64, pid string) error {
	return nil
}
func (r *stubInfraRepoFull) UpdateOutputs(ctx context.Context, id int64, outputs map[string]string) error {
	return nil
}
func (r *stubInfraRepoFull) FindByOrderID(ctx context.Context, orderID int64) (*model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepoFull) FindByProductID(ctx context.Context, productID int64) ([]model.InfrastructureElement, error) {
	return nil, nil
}
