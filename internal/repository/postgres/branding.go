package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/porr-ag/infra-webshop/internal/model"
	"github.com/porr-ag/infra-webshop/internal/repository"
)

type brandingRepo struct{ pool *pgxpool.Pool }

func NewBrandingRepository(pool *pgxpool.Pool) repository.BrandingRepository {
	return &brandingRepo{pool}
}

func (r *brandingRepo) Load(ctx context.Context) (*model.Branding, error) {
	var b model.Branding
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(logo_data, ''::bytea), logo_mime, primary_color, secondary_color,
		        shop_name, shop_subtitle, imprint_text
         FROM branding WHERE id=1`,
	).Scan(&b.LogoData, &b.LogoMime, &b.PrimaryColor, &b.SecondaryColor,
		&b.ShopName, &b.ShopSubtitle, &b.ImprintText)
	if err != nil {
		return &model.Branding{PrimaryColor: "#131921", SecondaryColor: "#febd69"}, nil
	}
	return &b, nil
}

func (r *brandingRepo) Save(ctx context.Context, b *model.Branding) error {
	var err error
	if len(b.LogoData) > 0 {
		_, err = r.pool.Exec(ctx,
			`INSERT INTO branding(id,logo_data,logo_mime,primary_color,secondary_color,shop_name,shop_subtitle,imprint_text)
			 VALUES(1,$1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT(id) DO UPDATE SET logo_data=EXCLUDED.logo_data, logo_mime=EXCLUDED.logo_mime,
             primary_color=EXCLUDED.primary_color, secondary_color=EXCLUDED.secondary_color,
             shop_name=EXCLUDED.shop_name, shop_subtitle=EXCLUDED.shop_subtitle, imprint_text=EXCLUDED.imprint_text`,
			b.LogoData, b.LogoMime, b.PrimaryColor, b.SecondaryColor, b.ShopName, b.ShopSubtitle, b.ImprintText)
	} else {
		_, err = r.pool.Exec(ctx,
			`INSERT INTO branding(id,primary_color,secondary_color,shop_name,shop_subtitle,imprint_text)
			 VALUES(1,$1,$2,$3,$4,$5)
             ON CONFLICT(id) DO UPDATE SET primary_color=EXCLUDED.primary_color, secondary_color=EXCLUDED.secondary_color,
             shop_name=EXCLUDED.shop_name, shop_subtitle=EXCLUDED.shop_subtitle, imprint_text=EXCLUDED.imprint_text`,
			b.PrimaryColor, b.SecondaryColor, b.ShopName, b.ShopSubtitle, b.ImprintText)
	}
	return err
}
