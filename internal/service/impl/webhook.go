package impl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// fireWebhook posts a GitLab pipeline trigger request and returns the pipeline ID string.
func fireWebhook(ctx context.Context, client *http.Client, urlStr, token string, variables []map[string]string) (string, error) {
	if strings.TrimSpace(urlStr) == "" {
		return "", fmt.Errorf("webhook url is empty")
	}
	form := url.Values{}
	form.Set("token", token)
	form.Set("ref", "main")
	for _, v := range variables {
		key, ok := v["key"]
		if !ok || key == "" {
			continue
		}
		value, _ := v["value"]
		form.Set("variables["+key+"]", value)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, urlStr, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("webhook call: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	slog.Info("webhook response", "status", resp.StatusCode, "body", string(body))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("webhook returned %d: %s", resp.StatusCode, string(body))
	}
	var wr struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(body, &wr); err == nil && wr.ID > 0 {
		return fmt.Sprintf("%d", wr.ID), nil
	}
	slog.Warn("webhook: no pipeline ID in response", "body", string(body))
	return "", nil
}

// buildVars constructs GitLab trigger variables from order parameters plus one extra key/value.
// Reserved pipeline variables must not be passed through from user-defined parameters.
func buildVars(params map[string]string, extraKey, extraVal string) []map[string]string {
	reserved := map[string]bool{
		"ORDER_ID":  true,
		"INFRA_ID":  true,
		"TF_ACTION": true,
		"DESTROY":   true,
	}
	vars := make([]map[string]string, 0, len(params)+1)
	vars = append(vars, map[string]string{"key": extraKey, "value": extraVal})
	for k, v := range params {
		key := strings.ToUpper(k)
		if reserved[key] {
			continue
		}
		vars = append(vars, map[string]string{"key": key, "value": v})
	}
	return vars
}
