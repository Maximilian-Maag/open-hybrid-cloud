package repo.policy_test

import data.repo.policy

reads(name, app) := {"name": name, "file": sprintf("%s/src/lib/x.ts", [app]), "line": 4, "app": app}

example(file, names) := {
	"file": file,
	"keys": [{"name": name, "line": 1} | some name in names],
	"duplicates": [],
}

env(readings, examples) := {
	"envReads": readings,
	"envExamples": examples,
	"envExampleFile": ".env.example",
}

root_and_backend(names) := [
	example(".env.example", names),
	example("apps/backend/.env.example", names),
]

test_a_documented_variable_passes if {
	facts := env([reads("JWT_SECRET", "apps/backend")], root_and_backend(["JWT_SECRET"]))
	denied := policy.deny with input as facts
	count(denied) == 0
}

test_an_undocumented_variable_is_denied if {
	facts := env([reads("SWEEP_SECRET", "apps/backend")], root_and_backend(["JWT_SECRET"]))
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.rule == "env_var_is_documented"
	contains(v.detail, "`SWEEP_SECRET` is read by apps/backend")
	contains(v.detail, ".env.example")
	contains(v.why, "operator")
}

# The per-app file is the one loaded in development and the root file is the
# whole-stack reference, so being in one of them is not being documented — but it
# is one finding naming both, not two findings.
test_a_variable_in_the_root_file_only_is_denied_once if {
	facts := env(
		[reads("TRUST_PROXY", "apps/backend")],
		[
			example(".env.example", ["TRUST_PROXY"]),
			example("apps/backend/.env.example", []),
		],
	)
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.file == "apps/backend/.env.example"
	contains(v.detail, "apps/backend/.env.example")
	not contains(v.detail, " or ")
}

# `NEXT_PUBLIC_API_URL` is read in nine components. Nine findings for one missing
# line in one file is the shape of report people learn to skip, so the violation
# carries no read-site coordinates and the set collapses them.
test_many_reads_of_one_variable_are_one_finding if {
	facts := env(
		[
			reads("API_URL", "apps/frontend"),
			{"name": "API_URL", "file": "apps/frontend/src/components/a.tsx", "line": 9, "app": "apps/frontend"},
			{"name": "API_URL", "file": "apps/frontend/src/components/b.tsx", "line": 2, "app": "apps/frontend"},
		],
		[example(".env.example", []), example("apps/frontend/.env.example", [])],
	)
	denied := policy.deny with input as facts
	count(denied) == 1
}

# The same name read by both apps is genuinely two edits, in two different files.
test_one_name_read_by_both_apps_is_two_findings if {
	facts := env(
		[reads("API_URL", "apps/backend"), reads("API_URL", "apps/frontend")],
		[
			example(".env.example", ["API_URL"]),
			example("apps/backend/.env.example", []),
			example("apps/frontend/.env.example", []),
		],
	)
	denied := policy.deny with input as facts
	count(denied) == 2
}

# A tree with no per-app example must produce no rule at all, rather than every
# variable at once — a gate that opens with fifty findings is a gate nobody reads.
test_an_absent_example_file_is_not_a_hundred_findings if {
	facts := env(
		[reads("JWT_SECRET", "apps/backend"), reads("DATABASE_URL", "apps/backend")],
		[example(".env.example", ["JWT_SECRET", "DATABASE_URL"])],
	)
	denied := policy.deny with input as facts
	count(denied) == 0
}

# --- rule 17b: duplicate keys ----------------------------------------------

test_a_key_assigned_twice_is_denied if {
	facts := env([], [{
		"file": ".env.example",
		"keys": [{"name": "TRUST_PROXY", "line": 81}, {"name": "TRUST_PROXY", "line": 114}],
		"duplicates": [{"name": "TRUST_PROXY", "line": 114, "firstLine": 81}],
	}])
	denied := policy.deny with input as facts
	count(denied) == 1
	some v in denied
	v.rule == "env_example_key_is_unique"
	v.file == ".env.example"
	v.line == 114
	contains(v.detail, "already been set on line 81")
	contains(v.why, "last assignment")
}

# The same name in two different example files is not a duplicate: they are
# separate files loaded by separate processes, and that is the intended shape.
test_the_same_key_in_two_files_is_not_a_duplicate if {
	facts := env([], root_and_backend(["JWT_SECRET"]))
	denied := policy.deny with input as facts
	count(denied) == 0
}
