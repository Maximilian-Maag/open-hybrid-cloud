package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

// --- hasRole ---

func TestHasRole_exactMatch(t *testing.T) {
	cases := []struct {
		actual, required model.Role
		want             bool
	}{
		{model.RoleProjectLeader, model.RoleProjectLeader, true},
		{model.RoleAdmin, model.RoleAdmin, true},
		{model.RoleShopAdmin, model.RoleShopAdmin, true},
	}
	for _, tc := range cases {
		if got := hasRole(tc.actual, tc.required); got != tc.want {
			t.Errorf("hasRole(%q, %q) = %v, want %v", tc.actual, tc.required, got, tc.want)
		}
	}
}

func TestHasRole_hierarchy(t *testing.T) {
	cases := []struct {
		actual, required model.Role
		want             bool
	}{
		{model.RoleShopAdmin, model.RoleAdmin, true},
		{model.RoleShopAdmin, model.RoleProjectLeader, true},
		{model.RoleAdmin, model.RoleProjectLeader, true},
		{model.RoleAdmin, model.RoleShopAdmin, false},
		{model.RoleProjectLeader, model.RoleAdmin, false},
		{model.RoleProjectLeader, model.RoleShopAdmin, false},
	}
	for _, tc := range cases {
		if got := hasRole(tc.actual, tc.required); got != tc.want {
			t.Errorf("hasRole(%q, %q) = %v, want %v", tc.actual, tc.required, got, tc.want)
		}
	}
}

// --- Require middleware ---

func TestRequire_redirectsWithoutSession(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	handler := store.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Errorf("want 303, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/login" {
		t.Errorf("want redirect to /login, got %q", loc)
	}
}

func TestRequire_allowsValidSession(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	called := false
	handler := store.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		d, ok := FromContext(r.Context())
		if !ok || d.Email != "user@example.com" {
			t.Errorf("session not in context or wrong email")
		}
		w.WriteHeader(http.StatusOK)
	}))

	// Create a request with a valid session cookie.
	rec := httptest.NewRecorder()
	_ = store.Set(rec, SessionData{UserID: 1, Email: "user@example.com", Role: model.RoleAdmin})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	for _, c := range rec.Result().Cookies() {
		req.AddCookie(c)
	}

	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req)

	if rec2.Code != http.StatusOK {
		t.Errorf("want 200, got %d", rec2.Code)
	}
	if !called {
		t.Error("inner handler was not called")
	}
}

// --- RequireRole middleware ---

func TestRequireRole_forbidsInsufficientRole(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	handler := store.RequireRole(model.RoleShopAdmin, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	_ = store.Set(rec, SessionData{UserID: 1, Email: "user@example.com", Role: model.RoleAdmin})

	req := httptest.NewRequest(http.MethodGet, "/admin-only", nil)
	for _, c := range rec.Result().Cookies() {
		req.AddCookie(c)
	}

	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req)

	if rec2.Code != http.StatusForbidden {
		t.Errorf("want 403, got %d", rec2.Code)
	}
}

func TestRequireRole_allowsSufficientRole(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	called := false
	handler := store.RequireRole(model.RoleAdmin, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	_ = store.Set(rec, SessionData{UserID: 1, Email: "user@example.com", Role: model.RoleShopAdmin})

	req := httptest.NewRequest(http.MethodGet, "/admin-area", nil)
	for _, c := range rec.Result().Cookies() {
		req.AddCookie(c)
	}

	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req)

	if rec2.Code != http.StatusOK {
		t.Errorf("want 200, got %d", rec2.Code)
	}
	if !called {
		t.Error("inner handler was not called")
	}
}

func TestRequireRole_redirectsWithoutSession(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	handler := store.RequireRole(model.RoleAdmin, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/admin-area", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Errorf("want 303 redirect to login, got %d", rec.Code)
	}
}
