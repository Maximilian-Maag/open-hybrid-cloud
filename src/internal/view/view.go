// Package view defines typed view models used by templ page components.
// Each page receives a concrete struct — no map[string]any.
package view

import (
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/auth"
	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/i18n"
)

// Brand holds the runtime-configurable branding values.
type Brand struct {
	Name           string
	Subtitle       string
	PrimaryColor   string
	SecondaryColor string
	HasLogo        bool
	ImprintText    string
}

// PageData is the common layout context passed to every page component.
type PageData struct {
	Session        *auth.SessionData
	Flash          *auth.FlashData
	Path           string
	Lang           string
	Brand          Brand
	SupportedLangs []string
	SearchQuery    string
}

// WithSupportedLangs fills SupportedLangs from the i18n package.
func (pd PageData) WithSupportedLangs() PageData {
	pd.SupportedLangs = i18n.Supported()
	return pd
}
