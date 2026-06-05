package handler_test

import (
	"net/http"
	"testing"
)

func TestOrders_RequiresAuth(t *testing.T) {
	client := newClient(t)
	resp, err := client.Get(testServer.URL + "/orders")
	if err != nil {
		t.Fatalf("GET /orders: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestOrders_EmptyListForPL(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/orders")
	assertStatus(t, http.StatusOK, code)
}

func TestOrders_EmptyListForRoot(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testRootEmail, testRootPassword)

	code, _ := get(t, client, "/orders")
	assertStatus(t, http.StatusOK, code)
}

func TestOrderDetail_NotFound(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/orders/9999")
	assertStatus(t, http.StatusNotFound, code)
}

func TestOrderNew_RequiresAuth(t *testing.T) {
	client := newClient(t)
	resp, err := client.Get(testServer.URL + "/orders/new")
	if err != nil {
		t.Fatalf("GET /orders/new: %v", err)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/login" {
		t.Errorf("expected redirect to /login, ended up at %s", resp.Request.URL.Path)
	}
}

func TestOrderNew_LoadsForAuthUser(t *testing.T) {
	resetData(t)
	client := newClient(t)
	login(t, client, testPLEmail, testPLPassword)

	code, _ := get(t, client, "/orders/new")
	assertStatus(t, http.StatusOK, code)
}
