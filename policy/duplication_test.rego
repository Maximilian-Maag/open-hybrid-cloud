package repo.policy_test

import data.repo.policy

# --- rule 15: the language lists -------------------------------------------

list(file, symbol, codes) := {
	"file": file,
	"line": 1,
	"symbol": symbol,
	"what": "a thing",
	"found": true,
	"codes": codes,
}

lists(entries) := {"languageLists": entries}

frontend(codes) := list("apps/frontend/src/lib/i18n.ts", "SUPPORTED_LANGUAGES", codes)

backend(codes) := list("apps/backend/src/lib/ai/index.ts", "LANGUAGES", codes)

test_lists_holding_the_same_codes_pass if {
	facts := lists([frontend(["de", "en"]), backend(["en", "de"])])
	denied := policy.deny with input as facts
	count(denied) == 0
}

# A code the picker offers that the translation prompt never asks for.
test_a_code_missing_from_the_backend_copy_is_denied if {
	facts := lists([frontend(["de", "en", "sv"]), backend(["de", "en"])])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.rule == "duplicated_list_agrees"
	v.file == "apps/backend/src/lib/ai/index.ts"
	contains(v.detail, "`LANGUAGES` is missing sv")
	contains(v.detail, "apps/frontend/src/lib/i18n.ts")
}

# And the inverse, which has to name the frontend file — "the two differ" is not
# actionable without opening both.
test_a_code_missing_from_the_frontend_copy_is_denied if {
	facts := lists([frontend(["de", "en"]), backend(["de", "en", "sv"])])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.file == "apps/frontend/src/lib/i18n.ts"
	contains(v.detail, "`SUPPORTED_LANGUAGES` is missing sv")
}

# Both directions at once is two findings, not one: each file needs its own edit.
test_lists_that_disagree_both_ways_report_both if {
	facts := lists([frontend(["de", "ga"]), backend(["de", "sv"])])
	denied := policy.deny with input as facts
	count(denied) == 2
}

# The order the codes are declared in is not the invariant — the set is.
test_the_order_of_the_codes_does_not_matter if {
	facts := lists([frontend(["sv", "de", "en"]), backend(["en", "sv", "de"])])
	denied := policy.deny with input as facts
	count(denied) == 0
}

# The failure a comparison cannot see. Without this, renaming one declaration
# turns the rule off and reports success.
test_a_declaration_that_is_gone_is_denied if {
	facts := lists([frontend(["de"]), {
		"file": "apps/backend/src/lib/ai/index.ts",
		"line": 0,
		"symbol": "LANGUAGES",
		"what": "the AI translation prompt",
		"found": false,
		"codes": [],
	}])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	contains(v.detail, "is not declared here")
	contains(v.why, "LANGUAGE_LIST_DECLARATIONS")
}

# --- rule 16: the ESLint configs -------------------------------------------

config(file, rules) := {"file": file, "found": true, "rules": rules}

rule(name, value) := {"name": name, "value": value, "line": 7}

configs(entries) := {"eslintConfigs": entries}

be(rules) := config("apps/backend/eslint.config.mjs", rules)

fe(rules) := config("apps/frontend/eslint.config.mjs", rules)

test_identical_rule_blocks_pass if {
	rules := [rule("eqeqeq", `["error", "always"]`), rule("no-var", `"error"`)]
	denied := policy.deny with input as configs([be(rules), fe(rules)])
	count(denied) == 0
}

# The drift that actually happens: a rule added to whichever app someone was in.
test_a_rule_in_one_config_only_is_denied if {
	facts := configs([
		be([rule("eqeqeq", `"error"`), rule("no-var", `"error"`)]),
		fe([rule("eqeqeq", `"error"`)]),
	])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.rule == "eslint_configs_agree"
	v.file == "apps/frontend/eslint.config.mjs"
	contains(v.detail, "`no-var` is configured in apps/backend/eslint.config.mjs and is absent here")
}

# Absence has to be reported whichever file it is missing from, so this pair is
# checked in both directions — unlike a differing value, which is one finding.
test_a_rule_missing_from_the_backend_config_is_denied if {
	facts := configs([
		be([rule("eqeqeq", `"error"`)]),
		fe([rule("eqeqeq", `"error"`), rule("no-var", `"error"`)]),
	])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.file == "apps/backend/eslint.config.mjs"
}

test_the_same_rule_at_different_severities_is_denied if {
	facts := configs([
		be([rule("no-console", `["error", {"allow": ["error"]}]`)]),
		fe([rule("no-console", `"warn"`)]),
	])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.file == "apps/frontend/eslint.config.mjs"
	v.line == 7
	contains(v.detail, "is `\"warn\"` here")
}

# Formatting is not drift: the extractor collapses whitespace, so a re-indented
# option object must not fail a build.
test_whitespace_only_differences_are_not_drift if {
	facts := configs([
		be([rule("no-unused-vars", `["error", { "args": "none" }]`)]),
		fe([rule("no-unused-vars", `["error", { "args": "none" }]`)]),
	])
	denied := policy.deny with input as facts
	count(denied) == 0
}

test_a_config_that_is_gone_is_denied if {
	facts := configs([
		be([rule("eqeqeq", `"error"`)]),
		{"file": "apps/frontend/eslint.config.mjs", "found": false, "rules": []},
	])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.rule == "eslint_configs_agree"
	contains(v.why, "ESLINT_CONFIGS")
}
