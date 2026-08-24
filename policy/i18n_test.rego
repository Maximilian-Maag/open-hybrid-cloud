package repo.policy_test

import data.repo.policy

# SUPPORTED_LANGUAGES defaults to exactly the codes that have tables, so a
# fixture about rule 8 (missing keys) cannot trip rule 8b (missing tables). The
# tests for 8b set the two lists apart deliberately.
i18n(languages) := i18n_supporting(languages, [language.code | some language in languages])

i18n_supporting(languages, supported) := {"i18n": {
	"file": "apps/frontend/src/lib/i18n.ts",
	"interfaceKeys": ["signOut", "catalog", "orders"],
	"languages": languages,
	"supported": supported,
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

# --- rule 8b ---------------------------------------------------------------

# The failure rule 8 structurally cannot see: no table means no language object,
# so there is nothing for it to find keys missing from. The picker still offers
# the language and the whole UI answers in English.
test_a_supported_language_with_no_table_is_denied if {
	facts := i18n_supporting(
		[{"code": "en", "keyCount": 3, "missing": []}],
		["en", "sv"],
	)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "translation_key_in_every_language"
	contains(v.detail, "`sv` is in SUPPORTED_LANGUAGES and has no table")
	contains(v.why, "picker")
}

# And the inverse: a table nobody can select still has to be kept in step with
# every new key.
test_a_table_that_is_not_supported_is_denied if {
	facts := i18n_supporting(
		[
			{"code": "en", "keyCount": 3, "missing": []},
			{"code": "sv", "keyCount": 3, "missing": []},
		],
		["en"],
	)
	denied := policy.deny with input as facts
	some v in denied
	contains(v.detail, "`translations` has a `sv` table and SUPPORTED_LANGUAGES does not list it")
}

# Both lists agreeing is the passing case, and it is the one that would hide a
# vacuous rule: if 8b compared a set against itself it would never fire.
test_supported_and_tables_agreeing_passes if {
	facts := i18n_supporting(
		[
			{"code": "en", "keyCount": 3, "missing": []},
			{"code": "de", "keyCount": 3, "missing": []},
		],
		["en", "de"],
	)
	denied := policy.deny with input as facts
	count(denied) == 0
}
