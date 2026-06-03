package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/porr-ag/infra-webshop/src/internal/model"
)

// --- password ---

func TestPassword_positive(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !CheckPassword(hash, "correct-horse-battery-staple") {
		t.Error("CheckPassword: expected true for correct password")
	}
}

func TestPassword_negative_wrongPassword(t *testing.T) {
	hash, _ := HashPassword("secret")
	if CheckPassword(hash, "wrong-password") {
		t.Error("CheckPassword: expected false for wrong password")
	}
}

// --- session ---

func TestSession_positive(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")
	want := SessionData{
		UserID: 7,
		Email:  "user@example.com",
		Name:   "Test User",
		Role:   model.RoleAdmin,
		Lang:   "de",
	}

	rec := httptest.NewRecorder()
	if err := store.Set(rec, want); err != nil {
		t.Fatalf("Set: %v", err)
	}

	req := &http.Request{Header: http.Header{"Cookie": rec.Result().Header["Set-Cookie"]}}
	got, ok := store.Get(req)
	if !ok {
		t.Fatal("Get: expected session, got none")
	}
	if got.UserID != want.UserID || got.Email != want.Email || got.Role != want.Role {
		t.Errorf("session data mismatch: got %+v", got)
	}
}

func TestSession_negative_tamperedCookie(t *testing.T) {
	store := NewSessionStore("a-32-byte-secret-for-testing-ok!")

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: "tampered-garbage-value"})

	_, ok := store.Get(req)
	if ok {
		t.Error("Get: expected false for tampered cookie, got true")
	}
}
