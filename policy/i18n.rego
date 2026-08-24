# Rules about apps/frontend/src/lib/i18n.ts.
package repo.policy

# ---------------------------------------------------------------------------
# rule 8 — every Translations key exists in every language table
# ---------------------------------------------------------------------------

# The type permits a partial table and `t()` falls back to English per key, which
# is what lets a new string ship at all. That is the right runtime behaviour and
# the wrong review signal: nothing fails, so a key added to 2 of 25 tables looks
# finished. #100 found five such misses that the existing test's threshold could
# not see, because a threshold measures how much is translated and this measures
# whether anything was forgotten.
deny contains v if {
	some language in input.i18n.languages
	count(language.missing) > 0

	v := {
		"rule": "translation_key_in_every_language",
		"file": input.i18n.file,
		"line": 0,
		"detail": sprintf(
			"`%s` is missing %d of %d keys: %s",
			[language.code, count(language.missing), count(input.i18n.interfaceKeys), missing_sample(language)],
		),
		"why": concat("", [
			"t() falls back to English per key, so a missing key is invisible in CI and shows up as an ",
			"English word in the middle of a Greek sentence. Adding a UI string means adding 25 entries; ",
			"this is the check that says which of them you did not add.",
		]),
	}
}

missing_sample(language) := concat(", ", language.missing) if count(language.missing) <= 6

missing_sample(language) := sprintf("%s and %d more", [concat(", ", array.slice(language.missing, 0, 6)), count(language.missing) - 6]) if count(language.missing) > 6

# ---------------------------------------------------------------------------
# rule 8b — SUPPORTED_LANGUAGES and the translation tables are the same set
# ---------------------------------------------------------------------------

# Rule 8 above can only report a table it can see, so the one failure it could
# never catch is a table that is not there: delete `sv` from `translations` and
# every key is missing for Swedish, no language object is emitted, and the gate
# passes while the picker still offers Svenska. `t()` then answers the whole
# Swedish UI in English without anything failing.
table_codes := {language.code | some language in input.i18n.languages}

deny contains v if {
	some code in input.i18n.supported
	not code in table_codes

	v := {
		"rule": "translation_key_in_every_language",
		"file": input.i18n.file,
		"line": 0,
		"detail": sprintf("`%s` is in SUPPORTED_LANGUAGES and has no table in `translations`", [code]),
		"why": concat("", [
			"SUPPORTED_LANGUAGES is what the language picker offers. A code with no table is not a partial ",
			"translation the per-key fallback covers — it is an entire UI silently rendered in English for a ",
			"language the product claims to speak. Add the table, or take the code out of the list.",
		]),
	}
}

deny contains v if {
	some code in table_codes
	not code in {c | some c in input.i18n.supported}

	v := {
		"rule": "translation_key_in_every_language",
		"file": input.i18n.file,
		"line": 0,
		"detail": sprintf("`translations` has a `%s` table and SUPPORTED_LANGUAGES does not list it", [code]),
		"why": concat("", [
			"A table nobody can select is dead weight that still has to be kept in step with every new key. ",
			"Either the code belongs in SUPPORTED_LANGUAGES or the table should go.",
		]),
	}
}
