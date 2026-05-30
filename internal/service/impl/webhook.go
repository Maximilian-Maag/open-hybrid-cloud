package impl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// fireWebhook posts a GitLab pipeline trigger request and returns the pipeline ID string.
// Returns ("", nil) when the response contains no pipeline ID.
func fireWebhook(ctx context.Context, client *http.Client, url, token string, variables []map[string]string) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"token":     token,
		"ref":       "main",
		"variables": variables,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("webhook call: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("webhook returned %d: %s", resp.StatusCode, string(body))
	}
	var wr struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal(body, &wr) == nil && wr.ID > 0 {
		return fmt.Sprintf("%d", wr.ID), nil
	}
	return "", nil
}

// buildVars constructs GitLab trigger variables from order parameters plus one extra key/value.
func buildVars(params map[string]string, extraKey, extraVal string) []map[string]string {
	vars := make([]map[string]string, 0, len(params)+1)
	vars = append(vars, map[string]string{"key": extraKey, "value": extraVal})
	for k, v := range params {
		vars = append(vars, map[string]string{"key": strings.ToUpper(k), "value": v})
	}
	return vars
}
