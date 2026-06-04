package gitlab

import (
	"regexp"
	"strings"
)

type TFVariable struct {
	Name         string
	Type         string
	Description  string
	DefaultValue string
	Sensitive    bool
}

var (
	reVarBlock    = regexp.MustCompile(`(?s)variable\s+"([^"]+)"\s*\{(.*?)\}`)
	reType        = regexp.MustCompile(`type\s*=\s*(\w+)`)
	reDescription = regexp.MustCompile(`description\s*=\s*"([^"]*)"`)
	reDefault     = regexp.MustCompile(`default\s*=\s*"?([^"\n]*)"?`)
	reSensitive   = regexp.MustCompile(`sensitive\s*=\s*(true|false)`)
)

// ParseVariables extracts variable blocks from a Terraform variables.tf file content.
func ParseVariables(content []byte) []TFVariable {
	matches := reVarBlock.FindAllSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}

	vars := make([]TFVariable, 0, len(matches))
	for _, m := range matches {
		name := string(m[1])
		body := string(m[2])

		v := TFVariable{Name: name, Type: "string"}

		// Extract type
		if tm := reType.FindStringSubmatch(body); tm != nil {
			raw := strings.TrimSpace(tm[1])
			// Skip complex types (object/list/set/tuple literals starting with { or [)
			if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") {
				v.Type = "string"
			} else {
				v.Type = raw
			}
		}

		// Extract description
		if dm := reDescription.FindStringSubmatch(body); dm != nil {
			v.Description = dm[1]
		}

		// Extract default value
		if dfm := reDefault.FindStringSubmatch(body); dfm != nil {
			v.DefaultValue = strings.TrimSpace(strings.Trim(dfm[1], `"`))
		}

		// Extract sensitive
		if sm := reSensitive.FindStringSubmatch(body); sm != nil {
			v.Sensitive = sm[1] == "true"
		}

		vars = append(vars, v)
	}
	return vars
}
