package gitlab

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- tfparser ---

func TestParseVariables_positive(t *testing.T) {
	content := []byte(`
variable "vm_name" {
  type        = string
  description = "Name of the virtual machine"
  default     = "my-vm"
}

variable "disk_size" {
  type      = number
  sensitive = false
}
`)
	vars := ParseVariables(content)
	if len(vars) != 2 {
		t.Fatalf("want 2 variables, got %d", len(vars))
	}
	if vars[0].Name != "vm_name" {
		t.Errorf("var[0].Name: want vm_name, got %s", vars[0].Name)
	}
	if vars[0].Description != "Name of the virtual machine" {
		t.Errorf("var[0].Description mismatch: %s", vars[0].Description)
	}
	if vars[0].DefaultValue != "my-vm" {
		t.Errorf("var[0].DefaultValue: want my-vm, got %s", vars[0].DefaultValue)
	}
	if vars[1].Name != "disk_size" {
		t.Errorf("var[1].Name: want disk_size, got %s", vars[1].Name)
	}
}

func TestParseVariables_negative_noBlocks(t *testing.T) {
	content := []byte(`# just a comment, no variable blocks`)
	vars := ParseVariables(content)
	if vars != nil {
		t.Errorf("expected nil for empty content, got %v", vars)
	}
}

// --- client ---

func TestGetPipelineStatus_positive(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(Pipeline{ID: 42, Status: "success"})
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "test-token")
	p, err := client.GetPipelineStatus(context.Background(), 1, 42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Status != "success" {
		t.Errorf("Status: want success, got %s", p.Status)
	}
}

func TestGetPipelineStatus_negative_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "test-token")
	_, err := client.GetPipelineStatus(context.Background(), 1, 99)
	if err == nil {
		t.Error("expected error for 404 response, got nil")
	}
}
