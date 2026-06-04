package polling

import "testing"

func TestExtractProjectID_positive(t *testing.T) {
	url := "https://gitlab.example.com/api/v4/projects/123/trigger/pipeline"
	id, err := extractProjectID(url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 123 {
		t.Errorf("want 123, got %d", id)
	}
}

func TestExtractProjectID_negative_noProjectID(t *testing.T) {
	url := "https://gitlab.example.com/api/v4/trigger/pipeline"
	_, err := extractProjectID(url)
	if err == nil {
		t.Error("expected error for URL without project ID, got nil")
	}
}
