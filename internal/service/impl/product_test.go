package impl

import (
	"context"
	"testing"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type stubProductRepo struct {
	product *model.Product
}

func (r *stubProductRepo) FindAll(ctx context.Context) ([]model.Product, error) {
	if r.product != nil {
		return []model.Product{*r.product}, nil
	}
	return nil, nil
}
func (r *stubProductRepo) FindByID(ctx context.Context, id int64) (*model.Product, error) {
	if r.product != nil && r.product.ID == id {
		return r.product, nil
	}
	return nil, nil
}
func (r *stubProductRepo) FindByCategoryID(ctx context.Context, cid int64) ([]model.Product, error) {
	return nil, nil
}
func (r *stubProductRepo) Save(ctx context.Context, p *model.Product) error   { return nil }
func (r *stubProductRepo) Update(ctx context.Context, p *model.Product) error { return nil }
func (r *stubProductRepo) Delete(ctx context.Context, id int64) error         { return nil }

var _ repository.ProductRepository = (*stubProductRepo)(nil)

type stubTranslationRepo struct {
	translation *model.ProductTranslation
}

func (r *stubTranslationRepo) FindByProductID(ctx context.Context, pid int64) ([]model.ProductTranslation, error) {
	return nil, nil
}
func (r *stubTranslationRepo) FindByProductAndLang(ctx context.Context, pid int64, lang string) (*model.ProductTranslation, error) {
	if r.translation != nil && r.translation.ProductID == pid {
		return r.translation, nil
	}
	return nil, nil
}
func (r *stubTranslationRepo) Upsert(ctx context.Context, t *model.ProductTranslation) error {
	return nil
}

var _ repository.ProductTranslationRepository = (*stubTranslationRepo)(nil)

func TestProductService_GetByID_positive(t *testing.T) {
	prod := &model.Product{ID: 5, CategoryID: 1, BaseLanguage: "de"}
	trans := &model.ProductTranslation{ProductID: 5, LanguageCode: "de", Name: "Virtuelle Maschine", Description: "Eine VM"}
	svc := NewProductService(&stubProductRepo{product: prod}, &stubTranslationRepo{translation: trans})

	p, err := svc.GetByID(context.Background(), 5, "de")
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if p == nil {
		t.Fatal("expected product, got nil")
	}
	if p.Name != "Virtuelle Maschine" {
		t.Errorf("Name: want 'Virtuelle Maschine', got %q", p.Name)
	}
}

func TestProductService_GetByID_negative_notFound(t *testing.T) {
	svc := NewProductService(&stubProductRepo{}, &stubTranslationRepo{})

	p, err := svc.GetByID(context.Background(), 999, "de")
	if err != nil {
		t.Fatalf("GetByID: unexpected error: %v", err)
	}
	if p != nil {
		t.Errorf("expected nil for unknown ID, got %+v", p)
	}
}
