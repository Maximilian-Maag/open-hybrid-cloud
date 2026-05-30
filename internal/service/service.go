// Package service enthält die Geschäftslogik-Interfaces.
// Implementierungen werden je Feature in eigenen Dateien angelegt.
package service

import (
	"context"

	"github.com/porr-ag/infra-webshop/internal/model"
)

type ProductService interface {
	ListByCategory(ctx context.Context, categoryID int64, lang string) ([]model.Product, error)
	GetByID(ctx context.Context, id int64, lang string) (*model.Product, error)
}

type OrderService interface {
	Create(ctx context.Context, order *model.Order) error
	Approve(ctx context.Context, orderID, adminID int64) error
	Reject(ctx context.Context, orderID, adminID int64, note string) error
	ListPendingApproval(ctx context.Context) ([]model.Order, error)
}

type ProjectService interface {
	Create(ctx context.Context, project *model.Project) error
	ListByOwner(ctx context.Context, ownerID int64) ([]model.Project, error)
	GetByID(ctx context.Context, id int64) (*model.Project, error)
}

type InfrastructureService interface {
	ListByProject(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error)
	Decommission(ctx context.Context, elementID, userID int64) error
}

type UserService interface {
	GetByID(ctx context.Context, id int64) (*model.User, error)
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	Create(ctx context.Context, user *model.User, password string) error
}

type AuditService interface {
	Log(ctx context.Context, entry *model.AuditEntry) error
	List(ctx context.Context, filter AuditFilter) ([]model.AuditEntry, error)
}

type AuditFilter struct {
	UserID    int64
	Action    model.AuditAction
	FromTime  string
	ToTime    string
}
