package impl

import (
	"context"

	"github.com/porr-ag/infra-webshop/src/internal/model"
	"github.com/porr-ag/infra-webshop/src/internal/repository"
	"github.com/porr-ag/infra-webshop/src/internal/service"
)

type productService struct {
	products     repository.ProductRepository
	translations repository.ProductTranslationRepository
}

func NewProductService(
	products repository.ProductRepository,
	translations repository.ProductTranslationRepository,
) service.ProductService {
	return &productService{products, translations}
}

func (s *productService) ListAll(ctx context.Context, lang string) ([]model.Product, error) {
	prods, err := s.products.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return s.attachTranslations(ctx, prods, lang)
}

func (s *productService) ListByCategory(ctx context.Context, categoryID int64, lang string) ([]model.Product, error) {
	prods, err := s.products.FindByCategoryID(ctx, categoryID)
	if err != nil {
		return nil, err
	}
	return s.attachTranslations(ctx, prods, lang)
}

func (s *productService) GetByID(ctx context.Context, id int64, lang string) (*model.Product, error) {
	p, err := s.products.FindByID(ctx, id)
	if err != nil || p == nil {
		return p, err
	}
	t, _ := s.translations.FindByProductAndLang(ctx, p.ID, lang)
	if t == nil {
		t, _ = s.translations.FindByProductAndLang(ctx, p.ID, p.BaseLanguage)
	}
	if t != nil {
		p.Name = t.Name
		p.Description = t.Description
	}
	return p, nil
}

func (s *productService) Save(ctx context.Context, p *model.Product) error {
	return s.products.Save(ctx, p)
}

func (s *productService) Update(ctx context.Context, p *model.Product) error {
	return s.products.Update(ctx, p)
}

func (s *productService) Delete(ctx context.Context, id int64) error {
	return s.products.Delete(ctx, id)
}

func (s *productService) attachTranslations(ctx context.Context, prods []model.Product, lang string) ([]model.Product, error) {
	for i := range prods {
		t, _ := s.translations.FindByProductAndLang(ctx, prods[i].ID, lang)
		if t == nil {
			t, _ = s.translations.FindByProductAndLang(ctx, prods[i].ID, prods[i].BaseLanguage)
		}
		if t != nil {
			prods[i].Name = t.Name
			prods[i].Description = t.Description
		}
	}
	return prods, nil
}
