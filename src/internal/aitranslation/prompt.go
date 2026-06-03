package aitranslation

import (
	"encoding/json"
	"fmt"
	"strings"
)

func buildPrompt(name, description, sourceLang string, targetLangs []string) string {
	return fmt.Sprintf(`Translate the following product name and description from %s into these languages: %s.
Return ONLY a valid JSON object. Keys are BCP-47 language codes. Each value has "name" and "description" fields.
Example format: {"de":{"name":"...","description":"..."},"fr":{"name":"...","description":"..."}}

Product name: %s
Product description: %s`, sourceLang, strings.Join(targetLangs, ", "), name, description)
}

func parseTranslations(content string) (map[string]Translation, error) {
	// Find the JSON object in the response (the model may include preamble text)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("no JSON object found in AI response")
	}
	jsonStr := content[start : end+1]
	var result map[string]Translation
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, fmt.Errorf("parse AI response JSON: %w", err)
	}
	return result, nil
}
