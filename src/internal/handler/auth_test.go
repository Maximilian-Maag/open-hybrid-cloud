package handler_test

import (
	"net/http"
	"net/url"
	"testing"
)

func TestLogin_PageLoads(t *testing.T) {
	client := newClient(t)
	code, body := get(t, client, "/login")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, "login")
}

func TestLogin_ValidRoot(t *testing.T) {
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	// After login the home page must be accessible.
	code, _ := get(t, client, "/")
	assertStatus(t, http.StatusOK, code)
}

func TestLogin_ValidAdmin(t *testing.T) {
	client := newClient(t)
	login(t, client, testAdminEmail, testAdminPassword)

	code, _ := get(t, client, "/")
	assertStatus(t, http.StatusOK, code)
}

func TestLogin_ValidProjectLeader(t *testing.T) {
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/")
	assertStatus(t, http.StatusOK, code)
}

func TestLogin_InvalidCredentials(t *testing.T) {
	client := newClient(t)

	// Post bad credentials — server returns 200 (login page with error, no redirect).
	resp, err := client.PostForm(testServer.URL+"/login", url.Values{
		"email":    {"nobody@test.local"},
		"password": {"wrong"},
	})
	if err != nil {
		t.Fatalf("POST /login: %v", err)
	}
	resp.Body.Close()
	// No redirect on failure: stays on login page (200) or redirects back (303).
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusSeeOther {
		t.Errorf("unexpected status %d after bad login", resp.StatusCode)
	}

	// Authenticated route must redirect back to /login.
	resp2, err := client.Get(testServer.URL + "/")
	if err != nil {
		t.Fatalf("GET / after bad login: %v", err)
	}
	resp2.Body.Close()
	if resp2.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login after bad credentials, ended up at %s", resp2.Request.URL.Path)
	}
}

func TestLogin_UnauthenticatedRedirect(t *testing.T) {
	client := newClient(t) // no login
	resp, err := client.Get(testServer.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	resp.Body.Close()
	// After following redirects the client ends up on the login page (200).
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 on login page, got %d", resp.StatusCode)
	}
	// The final URL must be /login.
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestLogout(t *testing.T) {
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code := post(t, client, "/logout", nil)
	// After logout the client follows the redirect to /login (200).
	assertStatus(t, http.StatusOK, code)

	// Home page must no longer be accessible.
	resp, err := client.Get(testServer.URL + "/")
	if err != nil {
		t.Fatalf("GET / after logout: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login after logout, ended up at %s", resp.Request.URL.Path)
	}
}
