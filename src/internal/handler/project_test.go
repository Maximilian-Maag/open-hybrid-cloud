package handler_test

import (
	"net/http"
	"net/url"
	"testing"
)

func TestProjects_RequiresAuth(t *testing.T) {
	client := newClient(t)
	resp, err := client.Get(testServer.URL + "/projects")
	if err != nil {
		t.Fatalf("GET /projects: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestProjects_EmptyList(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/projects")
	assertStatus(t, http.StatusOK, code)
}

func TestProjects_CreateAndList(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code := post(t, client, "/projects/new", url.Values{
		"name":        {"My Project"},
		"description": {"Test description"},
		"cost_center": {"CC-001"},
	})
	// POST redirects to /projects on success.
	assertStatus(t, http.StatusOK, code)

	code, body := get(t, client, "/projects")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, "My Project")
}

func TestProjectDetail_NotFound(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/projects/9999")
	assertStatus(t, http.StatusNotFound, code)
}

func TestProjects_RootSeesAll(t *testing.T) {
	resetData(t)

	// Create a project as project leader
	plClient := newClient(t)
	login(t, plClient, testPLEmail, testPLPassword)
	post(t, plClient, "/projects/new", url.Values{
		"name": {"PL Project"},
	})

	// Root must see all projects
	rootClient := newClient(t)
	login(t, rootClient, testRootEmail, testRootPassword)
	code, body := get(t, rootClient, "/projects")
	assertStatus(t, http.StatusOK, code)
	assertContains(t, body, "PL Project")
}
