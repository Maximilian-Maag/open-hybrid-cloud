# Rules about declarations that exist in more than one file and must agree.
package repo.policy

# ---------------------------------------------------------------------------
# rule 15 — every copy of the supported-language list holds the same codes
# ---------------------------------------------------------------------------

# The 25 language codes are declared twice and nothing connects them:
# `SUPPORTED_LANGUAGES` in the frontend is what the picker offers, and
# `LANGUAGES` in the backend goes verbatim into the prompt that asks the model
# for "exactly these 25 languages". Adding a code to one of them compiles, ships
# and looks finished — the picker gains a language whose translations are never
# requested, or the prompt spends tokens on a language nobody can select.
#
# `translation_key_in_every_language` in i18n.rego already ties the picker to the
# translation tables. This ties the picker to the backend, which is the other
# half and the one no test covers: the two lists sit in different apps, so no
# single test file imports both.
#
# Measured on dev when the rule was written: 2 declarations, 25 codes each, 0
# disagreements. A floor, not a cleanup — hence deny.
language_codes(list) := {code | some code in list.codes}

deny contains v if {
	some a in input.languageLists
	some b in input.languageLists
	a.found
	b.found
	a.file < b.file
	absent := language_codes(a) - language_codes(b)
	count(absent) > 0

	v := {
		"rule": "duplicated_list_agrees",
		"file": b.file,
		"line": b.line,
		"detail": sprintf(
			"`%s` is missing %s, which `%s` in %s lists",
			[b.symbol, concat(", ", sort(absent)), a.symbol, a.file],
		),
		"why": concat("", [
			"The supported languages are declared once for the picker and once for the AI translation ",
			"prompt, in different apps, so no test imports both and nothing fails when they drift. A code ",
			"in one list only is either a language the picker offers and the translator is never asked ",
			"for, or one the prompt pays for and nobody can select. Change both lists in the same diff.",
		]),
	}
}

# The mirror image. Written as its own block rather than folded into the one
# above because the message has to name which list is ahead — "these two differ"
# is not something anyone can act on without opening both files.
deny contains v if {
	some a in input.languageLists
	some b in input.languageLists
	a.found
	b.found
	a.file < b.file
	extra := language_codes(b) - language_codes(a)
	count(extra) > 0

	v := {
		"rule": "duplicated_list_agrees",
		"file": a.file,
		"line": a.line,
		"detail": sprintf(
			"`%s` is missing %s, which `%s` in %s lists",
			[a.symbol, concat(", ", sort(extra)), b.symbol, b.file],
		),
		"why": concat("", [
			"The supported languages are declared once for the picker and once for the AI translation ",
			"prompt, in different apps, so no test imports both and nothing fails when they drift. A code ",
			"in one list only is either a language the picker offers and the translator is never asked ",
			"for, or one the prompt pays for and nobody can select. Change both lists in the same diff.",
		]),
	}
}

# A declaration that has been renamed away is the failure a comparison cannot
# see: with one list gone there is nothing to disagree with, so the rule would go
# quiet at exactly the moment the copies stopped being checked. The extractor
# names the declarations it expects rather than searching for them, so this is
# decidable.
deny contains v if {
	some list in input.languageLists
	not list.found

	v := {
		"rule": "duplicated_list_agrees",
		"file": list.file,
		"line": 0,
		"detail": sprintf("`%s`, the copy of the language list used by %s, is not declared here", [list.symbol, list.what]),
		"why": concat("", [
			"This rule compares the copies of the language list against each other, so a copy it cannot ",
			"find is a rule that silently stops comparing. If the declaration moved or was renamed, update ",
			"LANGUAGE_LIST_DECLARATIONS in scripts/policy-facts.ts; if the copy is genuinely gone, remove ",
			"its row there and say so in the commit.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 16 — the two ESLint flat configs enforce the same rules
# ---------------------------------------------------------------------------

# Both configs open with the same paragraph claiming the rule blocks "are kept
# identical", and nothing checked it. They are two files in two packages that no
# single command diffs, so the way they drift is a rule added to the app someone
# happened to be working in — after which the other app is linted more loosely
# than anyone reading either file believes.
#
# The `ignores` lists are compared on purpose and the rules are not: `drizzle/**`
# and `public/swagger-ui/**` exist only in the backend, so those genuinely
# differ and a rule that compared whole files would be wrong every day.
#
# Measured on dev when the rule was written: 32 rules in each config, 0
# disagreements. Deny.
eslint_rules(config) := {rule.name: rule.value | some rule in config.rules}

eslint_rule_line(config, name) := line if {
	some rule in config.rules
	rule.name == name
	line := rule.line
}

deny contains v if {
	some a in input.eslintConfigs
	some b in input.eslintConfigs
	a.found
	b.found
	a.file != b.file
	some name, _ in eslint_rules(a)
	not name in object.keys(eslint_rules(b))

	v := {
		"rule": "eslint_configs_agree",
		"file": b.file,
		"line": 0,
		"detail": sprintf("`%s` is configured in %s and is absent here", [name, a.file]),
		"why": concat("", [
			"Both configs say in their own header that the rule blocks are kept identical, and until now ",
			"nothing checked it. A rule present in one app only means the other app is linted more loosely ",
			"than anyone reading either file believes — and the loose one is where the next defect lands. ",
			"Copy the entry, comment and all. The `ignores` lists are deliberately not compared: each app ",
			"has its own generated trees.",
		]),
	}
}

deny contains v if {
	some a in input.eslintConfigs
	some b in input.eslintConfigs
	a.found
	b.found
	a.file < b.file
	some name, value in eslint_rules(a)
	other := eslint_rules(b)[name]
	other != value

	v := {
		"rule": "eslint_configs_agree",
		"file": b.file,
		"line": eslint_rule_line(b, name),
		"detail": sprintf("`%s` is `%s` here and `%s` in %s", [name, other, value, a.file]),
		"why": concat("", [
			"A rule configured at a different severity or with different options in the two apps is worse ",
			"than one that is missing: both files claim to be identical, so a reviewer checks one and ",
			"believes the other. Settle on one configuration and put it in both.",
		]),
	}
}

# As with the language lists, a config file the gate cannot find is a comparison
# that silently stops happening.
deny contains v if {
	some config in input.eslintConfigs
	not config.found

	v := {
		"rule": "eslint_configs_agree",
		"file": config.file,
		"line": 0,
		"detail": "this ESLint config is one of the pair this rule compares, and it is not there",
		"why": concat("", [
			"With one config missing there is nothing left to disagree with, so the rule would report ",
			"success at exactly the moment it stopped checking anything. If the file moved, update ",
			"ESLINT_CONFIGS in scripts/policy-facts.ts in the same diff.",
		]),
	}
}
