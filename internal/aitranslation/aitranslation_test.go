package aitranslation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewTranslator_positive_knownProvider(t *testing.T) {
	tr := NewTranslator("claude", "", "test-key", "")
	if tr == nil {
		t.Error("NewTranslator(claude): expected non-nil translator")
	}
}

func TestNewTranslator_negative_emptyProvider(t *testing.T) {
	tr := NewTranslator("", "", "", "")
	if tr != nil {
		t.Error("NewTranslator(empty): expected nil, got translator")
	}
}

func TestClaudeTranslator_positive_mockServer(t *testing.T) {
	// Minimal Anthropic Messages API mock response
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": `{"en":{"name":"Virtual Machine","description":"A VM"}}`},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	tr := &claudeTranslator{
		endpoint: srv.URL,
		apiKey:   "test",
		model:    "claude-test",
	}
	results, err := tr.Translate(context.Background(), "Virtuelle Maschine", "Eine VM", "de", []string{"en"})
	if err != nil {
		t.Fatalf("Translate: %v", err)
	}
	if _, ok := results["en"]; !ok {
		t.Error("expected 'en' in results")
	}
}

func TestClaudeTranslator_negative_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "overloaded", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	tr := &claudeTranslator{endpoint: srv.URL, apiKey: "test", model: "claude-test"}
	_, err := tr.Translate(context.Background(), "Name", "Desc", "de", []string{"en"})
	if err == nil {
		t.Error("expected error for HTTP 503, got nil")
	}
}
