package e2e_test

import (
	"context"
	"strings"
	"testing"

	playwright "github.com/playwright-community/playwright-go"
)

// newPage creates an isolated browser context + page for a single test.
// The context is closed at the end of the test.
func newPage(t *testing.T) playwright.Page {
	t.Helper()
	bCtx, err := browser.NewContext(playwright.BrowserNewContextOptions{
		BaseURL: playwright.String(baseURL),
	})
	if err != nil {
		t.Fatalf("NewContext: %v", err)
	}
	t.Cleanup(func() { bCtx.Close() }) //nolint:errcheck

	page, err := bCtx.NewPage()
	if err != nil {
		t.Fatalf("NewPage: %v", err)
	}
	return page
}

// loginAs navigates to /login and submits the login form.
func loginAs(t *testing.T, page playwright.Page, email, password string) {
	t.Helper()
	if _, err := page.Goto("/login"); err != nil {
		t.Fatalf("goto /login: %v", err)
	}
	if err := page.Locator(`input[name="email"]`).Fill(email); err != nil {
		t.Fatalf("fill email: %v", err)
	}
	if err := page.Locator(`input[name="password"]`).Fill(password); err != nil {
		t.Fatalf("fill password: %v", err)
	}
	if err := page.Locator(`button[type="submit"]`).Click(); err != nil {
		t.Fatalf("click submit: %v", err)
	}
	if err := page.WaitForURL("**/"); err != nil {
		t.Fatalf("wait for redirect to /: %v", err)
	}
}

// resetData truncates all data tables except users and cost_centers so the
// bootstrapped admin user survives across tests.
func resetData(t *testing.T) {
	t.Helper()
	tables := strings.Join([]string{
		"audit_log",
		"infrastructure_elements",
		"orders",
		"projects",
		"product_webhooks",
		"product_environments",
		"product_translations",
		"products",
		"parameters",
		"deployment_environments",
		"gitlab_sources",
		"categories",
	}, ",")
	if _, err := testDB.Exec(context.Background(),
		"TRUNCATE "+tables+" RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("resetData: %v", err)
	}
}

type orderFixture struct {
	orderID int64
}

// seedPendingOrder inserts the minimal FK chain required for an order in
// pending_approval status and returns the new order ID.
func seedPendingOrder(t *testing.T) orderFixture {
	t.Helper()
	ctx := context.Background()

	var srcID, envID, userID, catID, prodID, projID, orderID int64

	if err := testDB.QueryRow(ctx,
		`INSERT INTO gitlab_sources (name, url, access_token)
		 VALUES ('e2e-source', 'https://gitlab.e2etest.local', 'token')
		 RETURNING id`).Scan(&srcID); err != nil {
		t.Fatalf("seed gitlab_source: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`INSERT INTO deployment_environments (name, gitlab_source_id, webhook_url, webhook_token)
		 VALUES ('e2e-env', $1, $2, 'wtoken')
		 RETURNING id`, srcID, webhookBaseURL+"/projects/1/trigger/pipeline").Scan(&envID); err != nil {
		t.Fatalf("seed deployment_environment: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`SELECT id FROM users WHERE email = $1`, adminEmail).Scan(&userID); err != nil {
		t.Fatalf("find admin user: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`INSERT INTO categories (name) VALUES ('E2E Category') RETURNING id`).Scan(&catID); err != nil {
		t.Fatalf("seed category: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`INSERT INTO products (category_id, base_language) VALUES ($1, 'de') RETURNING id`,
		catID).Scan(&prodID); err != nil {
		t.Fatalf("seed product: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`INSERT INTO projects (name, owner_id) VALUES ('E2E Project', $1) RETURNING id`,
		userID).Scan(&projID); err != nil {
		t.Fatalf("seed project: %v", err)
	}

	if err := testDB.QueryRow(ctx,
		`INSERT INTO orders (project_id, product_id, environment_id, user_id, status, parameters)
		 VALUES ($1, $2, $3, $4, 'pending_approval', '{}')
		 RETURNING id`,
		projID, prodID, envID, userID).Scan(&orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	return orderFixture{orderID: orderID}
}
