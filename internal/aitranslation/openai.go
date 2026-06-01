package aitranslation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type openAITranslator struct {
	endpoint   string
	apiKey     string
	model      string
	authHeader string
	authValue  string
}

func (t *openAITranslator) Translate(ctx context.Context, name, description, sourceLang string, targetLangs []string) (map[string]Translation, error) {
	prompt := buildPrompt(name, description, sourceLang, targetLangs)

	reqBody := struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}{
		Model: t.model,
		Messages: []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{
			{Role: "user", Content: prompt},
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal openai request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint+"/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create openai request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if t.authHeader != "" {
		req.Header.Set(t.authHeader, t.authValue)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read openai response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openai API returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	var respBody struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &respBody); err != nil {
		return nil, fmt.Errorf("unmarshal openai response: %w", err)
	}

	if len(respBody.Choices) == 0 {
		return nil, fmt.Errorf("openai response has no choices")
	}

	return parseTranslations(respBody.Choices[0].Message.Content)
}
