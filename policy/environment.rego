# Rules about the environment an operator has to configure.
package repo.policy

# ---------------------------------------------------------------------------
# rule 17 — every variable the code reads is in the .env.example files
# ---------------------------------------------------------------------------

# An undocumented variable is one an operator cannot know to set, and the way it
# is discovered is always the same: the feature is simply off, or off in a way
# that reads as a different bug. `DECOMMISSION_SWEEP_SECRET` unset is a 503 on a
# sweep endpoint; `SECRET_ENCRYPTION_KEY` unset is an integration that refuses to
# save a credential. Both of those are documented — this rule is what keeps the
# next one from not being.
#
# There are three example files and each read has to appear in two of them: the
# root `.env.example`, which is the whole-stack reference an operator deploying
# this reads, and `apps/<app>/.env.example`, which is the file actually loaded in
# development. That the two are hand-maintained copies is the reason this is a
# gate and not a convention.
#
# Measured on dev when the rule was written: 24 distinct variables read across
# both apps, all 24 documented in both required files. 0 violations. Deny.
#
# `NODE_ENV` is exempt (AMBIENT_ENV_VARS in scripts/policy-facts.ts) — it is set
# by the runtime, not by an operator. Test files are not scanned: `.env.example`
# documents what it takes to run the product, and a variable a fixture invents is
# not that.
env_example_files := {example.file | some example in input.envExamples}

documented_in(file) := {key.name |
	some example in input.envExamples
	example.file == file
	some key in example.keys
}

# The root reference plus the per-app file — but only the ones that exist, so a
# tree without a per-app example gets no rule at all rather than every variable
# reported at once.
required_examples(reading) := {file |
	some file in {input.envExampleFile, sprintf("%s/.env.example", [reading.app])}
	file in env_example_files
}

missing_examples(reading) := sort([file |
	some file in required_examples(reading)
	not reading.name in documented_in(file)
])

# One violation per variable and per app, not per read site: `NEXT_PUBLIC_API_URL`
# is read in nine components, and nine identical findings for one missing line in
# one file is the shape of report people start skipping. The violation object
# carries no read-site coordinates, so Rego's set semantics collapse them.
deny contains v if {
	some reading in input.envReads
	missing := missing_examples(reading)
	count(missing) > 0

	v := {
		"rule": "env_var_is_documented",
		"file": missing[0],
		"line": 0,
		"detail": sprintf(
			"`%s` is read by %s and is not documented in %s",
			[reading.name, reading.app, concat(" or ", missing)],
		),
		"why": concat("", [
			"A variable that is only in the code is one an operator cannot know to set, and an unset ",
			"variable usually presents as a feature being quietly off rather than as an error. Add it with ",
			"the comment that says what happens when it is blank — that sentence is the documentation, not ",
			"the name. Both the root .env.example and the per-app one need the entry; they are separate ",
			"hand-maintained files and that is exactly why this is checked.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 17b — no variable is assigned twice in one .env.example
# ---------------------------------------------------------------------------

# A duplicate is not a formatting complaint. Every loader here — docker compose
# `env_file`, `dotenv`, a shell `set -a; . .env` — takes the LAST assignment, so
# the entry an operator reads and edits may not be the one that takes effect, and
# the comment above the first one is silently describing something inert.
#
# This one was not free: `TRUST_PROXY` was assigned twice in `.env.example` and
# twice in `apps/backend/.env.example`, in both cases a block pasted into the
# middle of the section documenting `DECOMMISSION_SWEEP_SECRET`, which split that
# variable's explanation in two. 2 violations when the rule was written, both
# fixed in the same commit, so it ships as deny at zero.
deny contains v if {
	some example in input.envExamples
	some duplicate in example.duplicates

	v := {
		"rule": "env_example_key_is_unique",
		"file": example.file,
		"line": duplicate.line,
		"detail": sprintf("`%s` is assigned again here, having already been set on line %d", [duplicate.name, duplicate.firstLine]),
		"why": concat("", [
			"Every loader that reads these files — compose `env_file`, dotenv, `set -a` in a shell — keeps ",
			"the last assignment, so the entry an operator finds and edits need not be the one that takes ",
			"effect, and the comment above the other one documents nothing. Delete the copy; if the two ",
			"were meant to be different variables, the second one needs its own name.",
		]),
	}
}
