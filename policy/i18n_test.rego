package repo.policy_test

import data.repo.policy

i18n(languages) := {"i18n": {
	"file": "apps/frontend/src/lib/i18n.ts",
	"interfaceKeys": ["signOut", "catalog", "orders"],
	"languages": languages,
}}

test_language_missing_a_key_is_denied if {
	facts := i18n([{"code": "el", "keyCount": 2, "missing": ["orders"]}])
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "translation_key_in_every_language"
	v.file == "apps/frontend/src/lib/i18n.ts"
	contains(v.detail, "el")
	contains(v.detail, "orders")
	contains(v.why, "fall")
}

test_complete_languages_pass if {
	facts := i18n([
		{"code": "en", "keyCount": 3, "missing": []},
		{"code": "de", "keyCount": 3, "missing": []},
	])
	denied := policy.deny with input as facts
	count(denied) == 0
}

# The message names the keys, because "el is missing 43 keys" is not something
# anyone can act on.
test_a_short_miss_list_is_printed_in_full if {
	facts := i18n([{"code": "mt", "keyCount": 1, "missing": ["a", "b", "c"]}])
	denied := policy.deny with input as facts
	some v in denied
	contains(v.detail, "a, b, c")
}

test_a_long_miss_list_is_truncated if {
	facts := i18n([{"code": "mt", "keyCount": 1, "missing": ["a", "b", "c", "d", "e", "f", "g", "h"]}])
	denied := policy.deny with input as facts
	some v in denied
	contains(v.detail, "a, b, c, d, e, f and 2 more")
}

test_one_violation_per_language_not_per_key if {
	facts := i18n([{"code": "mt", "keyCount": 0, "missing": ["a", "b", "c"]}])
	denied := policy.deny with input as facts
	count(denied) == 1
}
