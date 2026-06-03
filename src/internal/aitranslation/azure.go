package aitranslation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type azureTranslator struct {
	endpoint string
	apiKey   string
	model    string
}

func (t *azureTranslator) Translate(ctx context.Context, name, description, sourceLang string, targetLangs []string) (map[string]Translation, error) {
	prompt := buildPrompt(name, description, sourceLang, targetLangs)

	reqBody := struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}{
		Messages: []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{
			{Role: "user", Content: prompt},
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal azure request: %w", err)
	}

	url := fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=2024-02-01", t.endpoint, t.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create azure request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", t.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("azure request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read azure response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("azure OpenAI API returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	var respBody struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &respBody); err != nil {
		return nil, fmt.Errorf("unmarshal azure response: %w", err)
	}

	if len(respBody.Choices) == 0 {
		return nil, fmt.Errorf("azure response has no choices")
	}

	return parseTranslations(respBody.Choices[0].Message.Content)
}
