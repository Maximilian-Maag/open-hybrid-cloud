// Package repository enthält die Datenbankzugriffs-Interfaces.
// Implementierungen werden je Feature in eigenen Dateien angelegt.
package repository

import (
	"context"
	"errors"
	"time"

	"github.com/porr-ag/infra-webshop/internal/model"
)

type UserRepository interface {
	FindByID(ctx context.Context, id int64) (*model.User, error)
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindBySSOSub(ctx context.Context, sub string) (*model.User, error)
	FindByRole(ctx context.Context, role model.Role) ([]model.User, error)
	FindAll(ctx context.Context) ([]model.User, error)
	Save(ctx context.Context, user *model.User) error
	Update(ctx context.Context, user *model.User) error
	UpdatePassword(ctx context.Context, id int64, passwordHash string) error
	SetActive(ctx context.Context, id int64, active bool) error
	Delete(ctx context.Context, id int64) error
}

// ErrReferenced is returned when a delete would violate a foreign-key
// constraint because the entity is still referenced by other rows.
var ErrReferenced = errors.New("referenced by other records")

type CategoryRepository interface {
	FindAll(ctx context.Context) ([]model.Category, error)
	FindByID(ctx context.Context, id int64) (*model.Category, error)
	Save(ctx context.Context, category *model.Category) error
	Update(ctx context.Context, category *model.Category) error
	Delete(ctx context.Context, id int64) error
}

type ProductRepository interface {
	FindAll(ctx context.Context) ([]model.Product, error)
	FindByID(ctx context.Context, id int64) (*model.Product, error)
	FindByCategoryID(ctx context.Context, categoryID int64) ([]model.Product, error)
	Save(ctx context.Context, product *model.Product) error
	Update(ctx context.Context, product *model.Product) error
	Delete(ctx context.Context, id int64) error
}

type ProductTranslationRepository interface {
	FindByProductID(ctx context.Context, productID int64) ([]model.ProductTranslation, error)
	FindByProductAndLang(ctx context.Context, productID int64, lang string) (*model.ProductTranslation, error)
	Upsert(ctx context.Context, t *model.ProductTranslation) error
}

type ParameterRepository interface {
	FindByScope(ctx context.Context, scope model.ParameterScope, scopeID int64) ([]model.Parameter, error)
	FindByScopeAndEnv(ctx context.Context, scope model.ParameterScope, scopeID int64, envID int64) ([]model.Parameter, error)
	FindByID(ctx context.Context, id int64) (*model.Parameter, error)
	Save(ctx context.Context, p *model.Parameter) error
	Update(ctx context.Context, p *model.Parameter) error
	Delete(ctx context.Context, id int64) error
}

type GitLabSourceRepository interface {
	FindAll(ctx context.Context) ([]model.GitLabSource, error)
	FindByID(ctx context.Context, id int64) (*model.GitLabSource, error)
	Save(ctx context.Context, s *model.GitLabSource) error
	Update(ctx context.Context, s *model.GitLabSource) error
	Delete(ctx context.Context, id int64) error
}

type EnvironmentRepository interface {
	FindAll(ctx context.Context) ([]model.DeploymentEnvironment, error)
	FindByID(ctx context.Context, id int64) (*model.DeploymentEnvironment, error)
	Save(ctx context.Context, env *model.DeploymentEnvironment) error
	Update(ctx context.Context, env *model.DeploymentEnvironment) error
	Delete(ctx context.Context, id int64) error
}

type ProductEnvironmentRepository interface {
	FindByProductID(ctx context.Context, productID int64) ([]model.ProductEnvironment, error)
	FindByProductAndEnv(ctx context.Context, productID, envID int64) (*model.ProductEnvironment, error)
	Upsert(ctx context.Context, pe *model.ProductEnvironment) error
	Delete(ctx context.Context, productID, envID int64) error
}

type CostCenterRepository interface {
	FindAll(ctx context.Context) ([]model.CostCenter, error)
	FindByID(ctx context.Context, id int64) (*model.CostCenter, error)
	Save(ctx context.Context, cc *model.CostCenter) error
	Update(ctx context.Context, cc *model.CostCenter) error
}

type ProjectRepository interface {
	FindByID(ctx context.Context, id int64) (*model.Project, error)
	FindByOwnerID(ctx context.Context, ownerID int64) ([]model.Project, error)
	FindAll(ctx context.Context) ([]model.Project, error)
	Save(ctx context.Context, project *model.Project) error
	Update(ctx context.Context, project *model.Project) error
	Delete(ctx context.Context, id int64) error
}

type OrderRepository interface {
	FindByID(ctx context.Context, id int64) (*model.Order, error)
	FindByUserID(ctx context.Context, userID int64) ([]model.Order, error)
	FindByStatus(ctx context.Context, status model.OrderStatus) ([]model.Order, error)
	Save(ctx context.Context, order *model.Order) error
	UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error
	UpdateRejection(ctx context.Context, id int64, note string) error
	AppendPipelineID(ctx context.Context, id int64, pipelineID string) error
}

type InfrastructureRepository interface {
	FindByProjectID(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error)
	FindByProductID(ctx context.Context, productID int64) ([]model.InfrastructureElement, error)
	FindAll(ctx context.Context) ([]model.InfrastructureElement, error)
	FindByID(ctx context.Context, id int64) (*model.InfrastructureElement, error)
	FindByStatuses(ctx context.Context, statuses []model.OrderStatus) ([]model.InfrastructureElement, error)
	Save(ctx context.Context, el *model.InfrastructureElement) error
	UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error
	AppendPipelineID(ctx context.Context, id int64, pipelineID string) error
	UpdateOutputs(ctx context.Context, id int64, outputs map[string]string) error
	FindByOrderID(ctx context.Context, orderID int64) (*model.InfrastructureElement, error)
}

type ProductWebhookRepository interface {
	FindByProductAndEnv(ctx context.Context, productID, envID int64) ([]model.ProductWebhook, error)
	Save(ctx context.Context, pw *model.ProductWebhook) error
	Delete(ctx context.Context, id int64) error
}

type ExchangeRateRepository interface {
	LoadAll(ctx context.Context) (map[string]float64, error)
	SaveAll(ctx context.Context, rates map[string]float64) error
}

type AuditRepository interface {
	Save(ctx context.Context, entry *model.AuditEntry) error
	FindAll(ctx context.Context) ([]model.AuditEntry, error)
	FindByUserID(ctx context.Context, userID int64) ([]model.AuditEntry, error)
	FindByAction(ctx context.Context, action model.AuditAction) ([]model.AuditEntry, error)
	FindFiltered(ctx context.Context, userID int64, action model.AuditAction, from, to *time.Time) ([]model.AuditEntry, error)
}

type BrandingRepository interface {
	Load(ctx context.Context) (*model.Branding, error)
	Save(ctx context.Context, b *model.Branding) error
}

type AppConfigRepository interface {
	Load(ctx context.Context) (*model.AppConfig, error)
	Save(ctx context.Context, cfg *model.AppConfig) error
}
