package e2e_test

import (
	"strings"
	"testing"
)

func TestCatalog_loads(t *testing.T) {
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/catalog"); err != nil {
		t.Fatalf("goto /catalog: %v", err)
	}

	heading, err := page.Locator(`h2`).First().TextContent()
	if err != nil {
		t.Fatalf("read h2: %v", err)
	}
	if heading == "" {
		t.Error("expected non-empty heading on catalog page")
	}
}

func TestCatalog_empty_state(t *testing.T) {
	resetData(t)
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/catalog"); err != nil {
		t.Fatalf("goto /catalog: %v", err)
	}

	count, err := page.Locator(`a[href*="/catalog/"]`).Count()
	if err != nil {
		t.Fatalf("count catalog links: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 product links on empty catalog, got %d", count)
	}
}

func TestCatalog_navigatesToProduct(t *testing.T) {
	resetData(t)
	// seedPendingOrder creates a category + product as side effect
	_ = seedPendingOrder(t)

	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/catalog"); err != nil {
		t.Fatalf("goto /catalog: %v", err)
	}

	link := page.Locator(`a[href*="/catalog/"]`).First()
	href, err := link.GetAttribute("href")
	if err != nil {
		t.Fatalf("get product link href: %v", err)
	}

	if _, err := page.Goto(href); err != nil {
		t.Fatalf("goto product page %s: %v", href, err)
	}

	// The product detail page always shows the "In Stock" badge regardless
	// of whether the product has a translation. Verify we landed on the page.
	if !strings.Contains(page.URL(), "/catalog/") {
		t.Errorf("expected catalog product URL, got %s", page.URL())
	}
	// The layout header with user name is always rendered — use it as a loaded check.
	if err := page.Locator(`header, nav`).First().WaitFor(); err != nil {
		t.Fatalf("product page did not render layout: %v", err)
	}
}
