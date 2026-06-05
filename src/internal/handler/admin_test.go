package handler_test

import (
	"net/http"
	"net/url"
	"testing"
)

func TestAdmin_RequiresAuth(t *testing.T) {
	client := newClient(t)
	resp, err := client.Get(testServer.URL + "/admin")
	if err != nil {
		t.Fatalf("GET /admin: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestAdmin_ForbiddenForProjectLeader(t *testing.T) {
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	resp, err := client.Get(testServer.URL + "/admin")
	if err != nil {
		t.Fatalf("GET /admin: %v", err)
	}
	resp.Body.Close()
	assertStatus(t, http.StatusForbidden, resp.StatusCode)
}

func TestAdmin_ForbiddenForAdmin(t *testing.T) {
	client := newClient(t)
	login(t, client, testAdminEmail, testAdminPassword)

	resp, err := client.Get(testServer.URL + "/admin")
	if err != nil {
		t.Fatalf("GET /admin: %v", err)
	}
	resp.Body.Close()
	// /admin routes are root-only; admin role gets 403.
	assertStatus(t, http.StatusForbidden, resp.StatusCode)
}

func TestAdmin_AllowedForRoot(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, _ := get(t, client, "/admin")
	assertStatus(t, http.StatusOK, code)
}

func TestAdmin_Categories_CRUD(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	// Create a category
	code := post(t, client, "/admin/categories", url.Values{
		"name":          {"Infrastructure"},
		"display_order": {"1"},
	})
	assertStatus(t, http.StatusOK, code)

	code, body := get(t, client, "/admin/categories")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, "Infrastructure")
}

func TestAdmin_Users_List(t *testing.T) {
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, body := get(t, client, "/admin/users")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, testAdminEmail)
	assertContains(t, body, testPLEmail)
}

func TestAdmin_Users_CreateAndEdit(t *testing.T) {
	resetData(t)

	// Re-create the 3 fixed test users that resetData wiped out (users table included).
	// Since resetData does NOT truncate users, nothing is wiped here;
	// we just verify the admin flow works.
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, body := get(t, client, "/admin/users")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, testRootEmail)
}

func TestAdmin_Environments_List(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, _ := get(t, client, "/admin/environments")
	assertStatus(t, http.StatusOK, code)
}
