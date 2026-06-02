// Package service enthält die Geschäftslogik-Interfaces.
// Implementierungen werden je Feature in eigenen Dateien angelegt.
package service

import (
	"context"
	"time"

	"github.com/porr-ag/infra-webshop/internal/model"
)

type ProductService interface {
	ListAll(ctx context.Context, lang string) ([]model.Product, error)
	ListByCategory(ctx context.Context, categoryID int64, lang string) ([]model.Product, error)
	GetByID(ctx context.Context, id int64, lang string) (*model.Product, error)
	Save(ctx context.Context, product *model.Product) error
	Update(ctx context.Context, product *model.Product) error
	Delete(ctx context.Context, id int64) error
}

type OrderService interface {
	Create(ctx context.Context, order *model.Order) error
	GetByID(ctx context.Context, id int64) (*model.Order, error)
	ListByUser(ctx context.Context, userID int64) ([]model.Order, error)
	Approve(ctx context.Context, orderID, adminID int64) error
	Reject(ctx context.Context, orderID, adminID int64, note string) error
	ListPendingApproval(ctx context.Context) ([]model.Order, error)
}

type ProjectService interface {
	Create(ctx context.Context, project *model.Project) error
	Update(ctx context.Context, project *model.Project) error
	Delete(ctx context.Context, id int64) error
	ListByOwner(ctx context.Context, ownerID int64) ([]model.Project, error)
	ListAll(ctx context.Context) ([]model.Project, error)
	GetByID(ctx context.Context, id int64) (*model.Project, error)
}

type InfrastructureService interface {
	ListByProject(ctx context.Context, projectID int64) ([]model.InfrastructureElement, error)
	ListAll(ctx context.Context) ([]model.InfrastructureElement, error)
	GetByID(ctx context.Context, id int64) (*model.InfrastructureElement, error)
	FindByOrderID(ctx context.Context, orderID int64) (*model.InfrastructureElement, error)
	Decommission(ctx context.Context, elementID, userID int64) error
}

type UserService interface {
	GetByID(ctx context.Context, id int64) (*model.User, error)
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	GetBySSOSub(ctx context.Context, sub string) (*model.User, error)
	Create(ctx context.Context, user *model.User, password string) error
	Update(ctx context.Context, user *model.User) error
	Delete(ctx context.Context, id int64) error
	ListAll(ctx context.Context) ([]model.User, error)
	VerifyPassword(ctx context.Context, email, password string) (*model.User, error)
	UpsertSSO(ctx context.Context, sub, email, name string, role model.Role) (*model.User, error)
	ChangePassword(ctx context.Context, id int64, currentPassword, newPassword string) error
	SetActive(ctx context.Context, id int64, active bool) error
}

type AuditService interface {
	Log(ctx context.Context, entry *model.AuditEntry) error
	List(ctx context.Context, filter AuditFilter) ([]model.AuditEntry, error)
}

type AuditFilter struct {
	UserID int64
	Action model.AuditAction
	From   *time.Time
	To     *time.Time
}
