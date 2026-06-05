package e2e_test

import (
	"fmt"
	"testing"

	playwright "github.com/playwright-community/playwright-go"
)

func TestApprovalList_empty(t *testing.T) {
	resetData(t)
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/approvals"); err != nil {
		t.Fatalf("goto /approvals: %v", err)
	}

	cards, err := page.Locator(`form[action*="/approve"]`).Count()
	if err != nil {
		t.Fatalf("count approval cards: %v", err)
	}
	if cards != 0 {
		t.Errorf("expected 0 pending orders, got %d", cards)
	}
}

func TestApproveButton(t *testing.T) {
	resetData(t)
	fix := seedPendingOrder(t)
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/approvals"); err != nil {
		t.Fatalf("goto /approvals: %v", err)
	}

	approveForm := page.Locator(fmt.Sprintf(`form[action="/approvals/%d/approve"]`, fix.orderID))
	if err := approveForm.WaitFor(); err != nil {
		t.Fatalf("approve form not found for order %d: %v", fix.orderID, err)
	}

	// Click and wait for the page reload triggered by the 303 redirect
	if err := approveForm.Locator(`button[type="submit"]`).Click(); err != nil {
		t.Fatalf("click approve: %v", err)
	}
	if err := page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle}); err != nil {
		t.Fatalf("wait for load after approve: %v", err)
	}

	remaining, err := page.Locator(fmt.Sprintf(`form[action="/approvals/%d/approve"]`, fix.orderID)).Count()
	if err != nil {
		t.Fatalf("count remaining approve forms: %v", err)
	}
	if remaining != 0 {
		t.Errorf("order %d still visible after approve", fix.orderID)
	}
}

func TestRejectButton(t *testing.T) {
	resetData(t)
	fix := seedPendingOrder(t)
	page := newPage(t)
	loginAs(t, page, adminEmail, adminPassword)

	if _, err := page.Goto("/approvals"); err != nil {
		t.Fatalf("goto /approvals: %v", err)
	}

	// The reject form lives inside a <details class="mt-4"> toggled by its summary.
	// Click the summary to reveal the form.
	if err := page.Locator(`details.mt-4 > summary`).First().Click(); err != nil {
		t.Fatalf("click reject summary: %v", err)
	}

	noteInput := page.Locator(`input[name="note"]`)
	if err := noteInput.WaitFor(); err != nil {
		t.Fatalf("rejection note input not visible: %v", err)
	}
	if err := noteInput.Fill("E2E test rejection"); err != nil {
		t.Fatalf("fill rejection note: %v", err)
	}

	rejectForm := page.Locator(fmt.Sprintf(`form[action="/approvals/%d/reject"]`, fix.orderID))
	if err := rejectForm.Locator(`button[type="submit"]`).Click(); err != nil {
		t.Fatalf("click reject submit: %v", err)
	}
	if err := page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle}); err != nil {
		t.Fatalf("wait for load after reject: %v", err)
	}

	remaining, err := page.Locator(fmt.Sprintf(`form[action="/approvals/%d/reject"]`, fix.orderID)).Count()
	if err != nil {
		t.Fatalf("count remaining reject forms: %v", err)
	}
	if remaining != 0 {
		t.Errorf("order %d still visible after reject", fix.orderID)
	}
}
