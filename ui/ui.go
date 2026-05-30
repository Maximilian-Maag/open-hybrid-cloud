// Package ui enthält die eingebetteten Templates und statischen Assets.
package ui

import "embed"

//go:embed templates
var Templates embed.FS

//go:embed static
var Static embed.FS
