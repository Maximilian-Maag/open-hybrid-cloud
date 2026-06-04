// Package ui holds the embedded templates and static assets.
package ui

import "embed"

//go:embed templates
var Templates embed.FS

//go:embed static
var Static embed.FS
