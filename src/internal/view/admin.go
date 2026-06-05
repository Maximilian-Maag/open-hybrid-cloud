package view

import "github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"

// AdminCategoriesView is the typed view model for the admin categories page.
type AdminCategoriesView struct {
	PageData
	Categories []model.Category
}
