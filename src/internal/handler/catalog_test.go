package handler_test

import (
	"net/http"
	"testing"
)

func TestCatalog_RequiresAuth(t *testing.T) {
	client := newClient(t) // no login
	resp, err := client.Get(testServer.URL + "/catalog")
	if err != nil {
		t.Fatalf("GET /catalog: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestCatalog_EmptyList(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, body := get(t, client, "/catalog")
	assertStatus(t, http.StatusOK, code)
	_ = body
}

func TestCatalogProduct_NotFound(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/catalog/9999")
	assertStatus(t, http.StatusNotFound, code)
}
