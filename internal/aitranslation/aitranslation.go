package aitranslation

import "context"

type Translation struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Translator interface {
	Translate(ctx context.Context, name, description, sourceLang string, targetLangs []string) (map[string]Translation, error)
}

// NewTranslator returns the right Translator implementation based on provider string.
// Returns nil if provider is empty (AI translation disabled).
// provider values: "claude", "openai", "ollama", "localai", "azure_openai"
func NewTranslator(provider, endpoint, apiKey, model string) Translator {
	switch provider {
	case "claude":
		return &claudeTranslator{endpoint: orDefault(endpoint, "https://api.anthropic.com"), apiKey: apiKey, model: orDefault(model, "claude-3-5-haiku-20241022")}
	case "openai":
		return &openAITranslator{endpoint: orDefault(endpoint, "https://api.openai.com"), apiKey: apiKey, model: orDefault(model, "gpt-4o-mini"), authHeader: "Authorization", authValue: "Bearer " + apiKey}
	case "ollama", "localai":
		return &openAITranslator{endpoint: endpoint, apiKey: "", model: orDefault(model, "llama3"), authHeader: "", authValue: ""}
	case "azure_openai":
		return &azureTranslator{endpoint: endpoint, apiKey: apiKey, model: model}
	default:
		return nil
	}
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}
