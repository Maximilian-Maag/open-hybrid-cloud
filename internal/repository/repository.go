// Package repository enthält die Datenbankzugriffs-Interfaces.
// Implementierungen werden je Feature in eigenen Dateien angelegt.
package repository

import (
	"context"

	"github.com/porr-ag/infra-webshop/internal/model"
)

type ProductRepository interface {
	FindAll(ctx context.Context) ([]model.Product, error)
	FindByID(ctx context.Context, id int64) (*model.Product, error)
	FindByCategoryID(ctx context.Context, categoryID int64) ([]model.Product, error)
	Save(ctx context.Context, product *model.Product) error
	Update(ctx context.Context, product *model.Product) error
}

type ProductTranslationRepository interface {
	FindByProductID(ctx context.Context, productID int64) ([]model.ProductTranslation, error)
	FindByProductAndLang(ctx context.Context, productID int64, lang string) (*model.ProductTranslation, error)
	Upsert(ctx context.Context, t *model.ProductTranslation) error
}

type OrderRepository interface {
	FindByID(ctx context.Context, id int64) (*model.Order, error)
	FindByUserID(ctx context.Context, userID int64) ([]model.Order, error)
	FindByStatus(ctx context.Context, status model.OrderStatus) ([]model.Order, error)
	Save(ctx context.Context, order *model.Order) error
	UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error
	UpdatePipelineID(ctx context.Context, id int64, pipelineID string) error
}

type ProjectRepository interface {
	FindByID(ctx context.Context, id int64) (*model.Project, error)
	FindByOwnerID(ctx context.Context, ownerID int64) ([]model.Project, error)
	FindAll(ctx context.Context) ([]model.Project, error)
	Save(ctx context.Context, project *model.Project) error
	Update(ctx context.Context, project *model.Project) error
}

type UserRepository interface {
	FindByID(ctx context.Context, id int64) (*model.User, error)
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindBySSOSub(ctx context.Context, sub string) (*model.User, error)
	FindAll(ctx context.Context) ([]model.User, error)
	Save(ctx context.Context, user *model.User) error
	Update(ctx context.Context, user *model.User) error
}

type AuditRepository interface {
	Save(ctx context.Context, entry *model.AuditEntry) error
	FindAll(ctx context.Context) ([]model.AuditEntry, error)
	FindByUserID(ctx context.Context, userID int64) ([]model.AuditEntry, error)
	FindByAction(ctx context.Context, action model.AuditAction) ([]model.AuditEntry, error)
}

type InfrastructureRepository interface {
	FindByProjectID(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error)
	FindAll(ctx context.Context) ([]model.InfrastructureElement, error)
	FindByID(ctx context.Context, id int64) (*model.InfrastructureElement, error)
	Save(ctx context.Context, el *model.InfrastructureElement) error
	UpdateStatus(ctx context.Context, id int64, status model.OrderStatus) error
}
