package handler_test

import (
	"net/http"
	"testing"
)

func TestApprovals_RequiresAuth(t *testing.T) {
	client := newClient(t)
	resp, err := client.Get(testServer.URL + "/approvals")
	if err != nil {
		t.Fatalf("GET /approvals: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestApprovals_ForbiddenForProjectLeader(t *testing.T) {
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	// /approvals requires at least admin role; project_leader gets 403.
	resp, err := client.Get(testServer.URL + "/approvals")
	if err != nil {
		t.Fatalf("GET /approvals: %v", err)
	}
	resp.Body.Close()
	// The middleware returns 403 without redirect.
	assertStatus(t, http.StatusForbidden, resp.StatusCode)
}

func TestApprovals_AllowedForAdmin(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testAdminEmail, testAdminPassword)

	code, _ := get(t, client, "/approvals")
	assertStatus(t, http.StatusOK, code)
}

func TestApprovals_AllowedForRoot(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, _ := get(t, client, "/approvals")
	assertStatus(t, http.StatusOK, code)
}
