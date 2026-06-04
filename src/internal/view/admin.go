package view

import "github.com/porr-ag/infra-webshop/src/internal/model"

// AdminCategoriesView is the typed view model for the admin categories page.
type AdminCategoriesView struct {
	PageData
	Categories []model.Category
}
