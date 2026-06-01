package impl

import (
	"context"
	"errors"
	"testing"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
	"github.com/porr-ag/infra-webshop/internal/service"
)

// --- stub repositories for order tests ---

type stubOrderRepo struct {
	orders map[int64]*model.Order
	nextID int64
}

func newStubOrderRepo() *stubOrderRepo {
	return &stubOrderRepo{orders: map[int64]*model.Order{}, nextID: 1}
}

func (r *stubOrderRepo) Save(ctx context.Context, o *model.Order) error {
	r.nextID++
	o.ID = r.nextID
	r.orders[o.ID] = o
	return nil
}
func (r *stubOrderRepo) FindByID(ctx context.Context, id int64) (*model.Order, error) {
	return r.orders[id], nil
}
func (r *stubOrderRepo) FindByUserID(ctx context.Context, uid int64) ([]model.Order, error) {
	return nil, nil
}
func (r *stubOrderRepo) FindByStatus(ctx context.Context, s model.OrderStatus) ([]model.Order, error) {
	return nil, nil
}
func (r *stubOrderRepo) UpdateStatus(ctx context.Context, id int64, s model.OrderStatus) error {
	if o, ok := r.orders[id]; ok {
		o.Status = s
	}
	return nil
}
func (r *stubOrderRepo) UpdateRejection(ctx context.Context, id int64, note string) error {
	return nil
}
func (r *stubOrderRepo) AppendPipelineID(ctx context.Context, id int64, pid string) error {
	return nil
}

var _ repository.OrderRepository = (*stubOrderRepo)(nil)

type stubInfraRepo2 struct{}

func (r *stubInfraRepo2) Save(ctx context.Context, el *model.InfrastructureElement) error {
	return nil
}
func (r *stubInfraRepo2) FindByID(ctx context.Context, id int64) (*model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepo2) FindAll(ctx context.Context) ([]model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepo2) FindByProjectID(ctx context.Context, pid int64) ([]model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepo2) FindByStatuses(ctx context.Context, s []model.OrderStatus) ([]model.InfrastructureElement, error) {
	return nil, nil
}
func (r *stubInfraRepo2) UpdateStatus(ctx context.Context, id int64, s model.OrderStatus) error {
	return nil
}
func (r *stubInfraRepo2) AppendPipelineID(ctx context.Context, id int64, pid string) error {
	return nil
}
func (r *stubInfraRepo2) UpdateOutputs(ctx context.Context, id int64, outputs map[string]string) error {
	return nil
}
func (r *stubInfraRepo2) FindByOrderID(ctx context.Context, orderID int64) (*model.InfrastructureElement, error) {
	return nil, nil
}

var _ repository.InfrastructureRepository = (*stubInfraRepo2)(nil)

type stubEnvRepo struct{}

func (r *stubEnvRepo) FindAll(ctx context.Context) ([]model.DeploymentEnvironment, error) {
	return nil, nil
}
func (r *stubEnvRepo) FindByID(ctx context.Context, id int64) (*model.DeploymentEnvironment, error) {
	return nil, errors.New("environment not found")
}
func (r *stubEnvRepo) Save(ctx context.Context, e *model.DeploymentEnvironment) error  { return nil }
func (r *stubEnvRepo) Update(ctx context.Context, e *model.DeploymentEnvironment) error { return nil }
func (r *stubEnvRepo) Delete(ctx context.Context, id int64) error                       { return nil }

var _ repository.EnvironmentRepository = (*stubEnvRepo)(nil)

type stubWebhookRepo struct{}

func (r *stubWebhookRepo) FindByProductAndEnv(ctx context.Context, pID, eID int64) ([]model.ProductWebhook, error) {
	return nil, nil
}
func (r *stubWebhookRepo) Save(ctx context.Context, pw *model.ProductWebhook) error   { return nil }
func (r *stubWebhookRepo) Delete(ctx context.Context, id int64) error                 { return nil }

var _ repository.ProductWebhookRepository = (*stubWebhookRepo)(nil)

type stubGitLabSourceRepo struct{}

func (r *stubGitLabSourceRepo) FindAll(ctx context.Context) ([]model.GitLabSource, error) {
	return nil, nil
}
func (r *stubGitLabSourceRepo) FindByID(ctx context.Context, id int64) (*model.GitLabSource, error) {
	return nil, nil
}
func (r *stubGitLabSourceRepo) Save(ctx context.Context, s *model.GitLabSource) error   { return nil }
func (r *stubGitLabSourceRepo) Update(ctx context.Context, s *model.GitLabSource) error { return nil }
func (r *stubGitLabSourceRepo) Delete(ctx context.Context, id int64) error              { return nil }

var _ repository.GitLabSourceRepository = (*stubGitLabSourceRepo)(nil)

type stubAudit struct{}

func (s *stubAudit) Log(ctx context.Context, e *model.AuditEntry) error { return nil }
func (s *stubAudit) List(ctx context.Context, f service.AuditFilter) ([]model.AuditEntry, error) {
	return nil, nil
}

var _ service.AuditService = (*stubAudit)(nil)

// --- tests ---

func TestOrderService_Create_positive(t *testing.T) {
	orderRepo := newStubOrderRepo()
	svc := NewOrderService(orderRepo, &stubInfraRepo2{}, &stubEnvRepo{}, &stubGitLabSourceRepo{}, &stubWebhookRepo{}, &stubAudit{})

	o := &model.Order{ProjectID: 1, ProductID: 2, UserID: 3}
	if err := svc.Create(context.Background(), o); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if o.Status != model.OrderStatusPendingApproval {
		t.Errorf("Status: want pending_approval, got %s", o.Status)
	}
	if o.ID == 0 {
		t.Error("expected ID to be set after Save")
	}
}

func TestOrderService_Approve_negative_orderNotFound(t *testing.T) {
	svc := NewOrderService(newStubOrderRepo(), &stubInfraRepo2{}, &stubEnvRepo{}, &stubGitLabSourceRepo{}, &stubWebhookRepo{}, &stubAudit{})

	// Order ID 999 was never saved → repo returns nil
	err := svc.Approve(context.Background(), 999, 1)
	if err == nil {
		t.Error("expected error when approving non-existent order, got nil")
	}
}
