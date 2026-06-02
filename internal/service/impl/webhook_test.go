package impl

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestBuildVars_positive(t *testing.T) {
	params := map[string]string{"env": "prod", "region": "eu-west-1"}
	vars := buildVars(params, "ORDER_ID", "42")

	// Must contain the extra key
	found := false
	for _, v := range vars {
		if v["key"] == "ORDER_ID" && v["value"] == "42" {
			found = true
		}
	}
	if !found {
		t.Error("buildVars: ORDER_ID not found in result")
	}
	// Params must be uppercased
	for _, v := range vars {
		if v["key"] == "env" {
			t.Error("buildVars: param key should be uppercased, got lowercase 'env'")
		}
	}
	if len(vars) != 3 { // ORDER_ID + ENV + REGION
		t.Errorf("buildVars: want 3 entries, got %d", len(vars))
	}
}

func TestBuildVars_filtersReservedKeys(t *testing.T) {
	params := map[string]string{"tf_action": "destroy", "DESTROY": "true", "env": "prod"}
	vars := buildVars(params, "ORDER_ID", "42")

	for _, v := range vars {
		if v["key"] == "TF_ACTION" || v["key"] == "DESTROY" {
			t.Errorf("buildVars: reserved key %q should not be forwarded", v["key"])
		}
	}
	if len(vars) != 2 { // ORDER_ID + ENV
		t.Errorf("buildVars: want 2 entries after filtering reserved keys, got %d", len(vars))
	}
}

func TestFireWebhook_negative_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := fireWebhook(context.Background(), &http.Client{}, srv.URL, "token", nil)
	if err == nil {
		t.Error("expected error for HTTP 500 response, got nil")
	}
}

func TestFireWebhook_positive_formEncoded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Content-Type"); got != "application/x-www-form-urlencoded" {
			t.Errorf("Content-Type: want %q, got %q", "application/x-www-form-urlencoded", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		vals, err := url.ParseQuery(string(body))
		if err != nil {
			t.Fatal(err)
		}
		if vals.Get("token") != "token" {
			t.Errorf("token: want token, got %q", vals.Get("token"))
		}
		if vals.Get("ref") != "main" {
			t.Errorf("ref: want main, got %q", vals.Get("ref"))
		}
		if vals.Get("variables[ORDER_ID]") != "42" {
			t.Errorf("variables[ORDER_ID]: want 42, got %q", vals.Get("variables[ORDER_ID]"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":123}`))
	}))
	defer srv.Close()

	pid, err := fireWebhook(context.Background(), &http.Client{}, srv.URL, "token", []map[string]string{{"key": "ORDER_ID", "value": "42"}})
	if err != nil {
		t.Fatalf("fireWebhook: %v", err)
	}
	if pid != "123" {
		t.Fatalf("pid: want 123, got %q", pid)
	}
}
