package impl

import (
	"context"
	"net/http"
	"net/http/httptest"
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
