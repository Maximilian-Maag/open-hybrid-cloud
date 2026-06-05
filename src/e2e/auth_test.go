package e2e_test

import (
	"strings"
	"testing"

	playwright "github.com/playwright-community/playwright-go"
)

func TestLogin_success(t *testing.T) {
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if !strings.HasSuffix(page.URL(), "/") {
		t.Errorf("expected redirect to /, got %s", page.URL())
	}
}

func TestLogin_invalidCredentials(t *testing.T) {
	page := newPage(t)

	if _, err := page.Goto("/login"); err != nil {
		t.Fatalf("goto /login: %v", err)
	}
	if err := page.Locator(`input[name="email"]`).Fill(adminEmail); err != nil {
		t.Fatalf("fill email: %v", err)
	}
	if err := page.Locator(`input[name="password"]`).Fill("wrongpassword"); err != nil {
		t.Fatalf("fill password: %v", err)
	}
	if err := page.Locator(`button[type="submit"]`).Click(); err != nil {
		t.Fatalf("click submit: %v", err)
	}

	// Should stay on /login with an error flash
	if err := page.WaitForURL("**/login"); err != nil {
		t.Fatalf("expected to remain on /login: %v", err)
	}
}

func TestLogout(t *testing.T) {
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	// The logout button is inside the user-menu <details> dropdown. Open it first.
	if err := page.Locator(`details:has(form[action="/logout"]) > summary`).Click(); err != nil {
		t.Fatalf("open user menu: %v", err)
	}

	logoutBtn := page.Locator(`form[action="/logout"] button[type="submit"]`)
	if err := logoutBtn.WaitFor(); err != nil {
		t.Fatalf("logout button not visible: %v", err)
	}
	if err := logoutBtn.Click(); err != nil {
		t.Fatalf("click logout: %v", err)
	}
	if err := page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle}); err != nil {
		t.Fatalf("wait after logout: %v", err)
	}
	if !strings.Contains(page.URL(), "/login") {
		t.Errorf("expected redirect to /login after logout, got %s", page.URL())
	}
}
