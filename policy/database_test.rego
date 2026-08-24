package repo.policy_test

import data.repo.policy

# --- rule 2 ----------------------------------------------------------------

test_secret_column_in_a_new_projection_is_denied if {
	facts := {"selects": [{
		"file": "apps/backend/src/lib/services/reports.ts",
		"line": 30,
		"columns": ["token: ciSources.accessToken"],
		"secretColumns": ["accessToken"],
	}]}
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "no_secret_column_in_select"
	v.line == 30
	contains(v.detail, "accessToken")
	contains(v.why, "#144")
}

test_listed_secret_read_is_allowed if {
	facts := {"selects": [{
		"file": "apps/backend/src/lib/db/queries.ts",
		"line": 71,
		"columns": ["accessToken: ciSources.accessToken"],
		"secretColumns": ["accessToken"],
	}]}
	denied := policy.deny with input as facts
	count(denied) == 0
}

# The allowlist is keyed by file *and* column, so a file that may read one
# credential does not thereby get to read every credential.
test_allowlist_does_not_cover_a_different_column_in_the_same_file if {
	facts := {"selects": [{
		"file": "apps/backend/src/lib/db/queries.ts",
		"line": 90,
		"columns": ["hash: users.passwordHash"],
		"secretColumns": ["passwordHash"],
	}]}
	denied := policy.deny with input as facts
	count(denied) == 1
}

# --- rule 3 ----------------------------------------------------------------

table(overrides) := object.union(
	{"export": "widgets", "name": "widgets", "secretColumns": [], "inTestDdl": true, "inTestTables": true},
	overrides,
)

test_table_missing_from_the_ddl_is_denied if {
	facts := {
		"tables": [table({"inTestDdl": false, "inTestTables": false})],
		"testSetupFile": "apps/backend/src/test/setup.ts",
		"schemaFile": "apps/backend/src/lib/db/schema.ts",
	}
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "table_in_test_setup"
	contains(v.detail, "widgets")
}

test_table_missing_only_from_TABLES_warns if {
	facts := {
		"tables": [table({"inTestTables": false})],
		"testSetupFile": "apps/backend/src/test/setup.ts",
		"schemaFile": "apps/backend/src/lib/db/schema.ts",
	}
	warned := policy.warn with input as facts
	denied := policy.deny with input as facts
	count(denied) == 0
	some v in warned
	v.rule == "table_in_test_setup"
	contains(v.why, "#147")
}

test_table_in_both_places_passes if {
	facts := {
		"tables": [table({})],
		"testSetupFile": "apps/backend/src/test/setup.ts",
		"schemaFile": "apps/backend/src/lib/db/schema.ts",
	}
	denied := policy.deny with input as facts
	warned := policy.warn with input as facts
	count(denied) == 0
	count(warned) == 0
}

# --- rule 4 ----------------------------------------------------------------

migrations(files, journal) := {"migrations": {
	"dir": "apps/backend/drizzle",
	"journalFile": "apps/backend/drizzle/meta/_journal.json",
	"files": files,
	"journal": journal,
}}

# A journal entry with a `when` derived from its idx, so a fixture that is not
# about `when` cannot accidentally trip the monotonicity rule.
entry(idx, tag) := {"idx": idx, "tag": tag, "when": 1000 + (idx * 100)}

test_migration_with_no_journal_entry_is_denied if {
	facts := migrations(
		[{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0}],
		[],
	)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "migration_matches_journal"
	v.file == "apps/backend/drizzle/0000_a.sql"
}

test_journal_entry_with_no_file_is_denied if {
	facts := migrations([], [entry(0, "0000_a")])
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "migration_matches_journal"
	contains(v.detail, "0000_a")
}

test_idx_disagreeing_with_the_filename_is_denied if {
	facts := migrations(
		[{"file": "apps/backend/drizzle/0003_a.sql", "tag": "0003_a", "index": 3}],
		[entry(7, "0003_a")],
	)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "migration_matches_journal"
	contains(v.detail, "idx 7")
}

test_matching_migrations_pass if {
	facts := migrations(
		[
			{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0},
			{"file": "apps/backend/drizzle/0001_b.sql", "tag": "0001_b", "index": 1},
		],
		[entry(0, "0000_a"), entry(1, "0001_b")],
	)
	denied := policy.deny with input as facts
	warned := policy.warn with input as facts
	count(denied) == 0
	count(warned) == 0
}

test_a_gap_in_the_numbering_warns_and_never_denies if {
	facts := migrations(
		[
			{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0},
			{"file": "apps/backend/drizzle/0002_c.sql", "tag": "0002_c", "index": 2},
		],
		[entry(0, "0000_a"), entry(2, "0002_c")],
	)
	denied := policy.deny with input as facts
	warned := policy.warn with input as facts
	count(denied) == 0
	some v in warned
	v.rule == "migration_numbering_is_contiguous"
	contains(v.detail, "gap at 1")
}

# A contiguous journal 0..21 and then *two* entries numbered 22 — the shape a
# real journal has when a duplicate slips in. The fixture is contiguous on
# purpose: the gap rule only asks whether each index has a predecessor, both 22s
# have a 21, so it stays silent and an ambiguous order passed every part of
# rule 4 before this rule existed. A short fixture would make the gap rule fire
# for its own reasons and prove nothing about the duplicate.
repeated_idx_files := array.concat(
	[{
		"file": sprintf("apps/backend/drizzle/%04d_m.sql", [i]),
		"tag": sprintf("%04d_m", [i]),
		"index": i,
	} |
		some i in numbers.range(0, 21)
	],
	[
		{"file": "apps/backend/drizzle/0022_a.sql", "tag": "0022_a", "index": 22},
		{"file": "apps/backend/drizzle/0022_b.sql", "tag": "0022_b", "index": 22},
	],
)

repeated_idx_journal := array.concat(
	[entry(i, sprintf("%04d_m", [i])) | some i in numbers.range(0, 21)],
	[entry(22, "0022_a"), {"idx": 22, "tag": "0022_b", "when": 3300}],
)

test_a_repeated_idx_is_denied if {
	facts := migrations(repeated_idx_files, repeated_idx_journal)
	denied := policy.deny with input as facts
	warned := policy.warn with input as facts
	some v in denied
	v.rule == "migration_matches_journal"
	contains(v.detail, "idx 22 is used by more than one entry")

	# And the gap rule stays quiet about it, which is why it needed its own rule.
	not "migration_numbering_is_contiguous" in {w.rule | some w in warned}
}

test_a_repeated_tag_is_denied if {
	facts := migrations(
		[{"file": "apps/backend/drizzle/0003_a.sql", "tag": "0003_a", "index": 3}],
		[entry(3, "0003_a"), {"idx": 4, "tag": "0003_a", "when": 1400}],
	)
	denied := policy.deny with input as facts
	some v in denied
	contains(v.detail, "tag \"0003_a\" is used by more than one entry")
}

# --- rule 4b ---------------------------------------------------------------

# The collision #194 fixes, in the shape the journal actually had it: distinct
# indices, distinct tags, and four entries sharing one `when`. Everything else in
# rule 4 passes on this input; only the `when` rule sees it.
journal_194 := [
	{"idx": 20, "tag": "0020_sizes_and_quantity", "when": 1787702400000},
	{"idx": 22, "tag": "0022_approval_delegations", "when": 1787702400000},
	{"idx": 23, "tag": "0023_integration_registry", "when": 1787702400000},
	{"idx": 24, "tag": "0024_product_retirement", "when": 1787702400000},
	{"idx": 25, "tag": "0025_rotate_reused_callback_secret", "when": 1787702400000},
]

files_194 := [file |
	some e in journal_194
	file := {"file": sprintf("apps/backend/drizzle/%s.sql", [e.tag]), "tag": e.tag, "index": e.idx}
]

test_the_194_collision_is_reported_once_per_skipped_migration if {
	facts := migrations(files_194, journal_194)
	warned := policy.warn with input as facts
	when_warnings := [w | some w in warned; w.rule == "migration_when_increases"]

	# Four entries share the watermark the first one set, and drizzle-kit skips
	# every one of them. All four are named, because "the journal is wrong" is not
	# something anyone can act on.
	count(when_warnings) == 4
	some v in when_warnings
	contains(v.detail, "0025_rotate_reused_callback_secret")
	contains(v.detail, "skips it")
	contains(v.why, "#194")
}

# The rest of rule 4 is satisfied by that input, which is the point: correspondence
# and contiguity both pass while four migrations never run.
test_the_194_collision_passes_every_other_part_of_rule_4 if {
	facts := migrations(files_194, journal_194)
	denied := policy.deny with input as facts
	count(denied) == 0
}

test_a_strictly_increasing_journal_passes if {
	facts := migrations(
		[
			{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0},
			{"file": "apps/backend/drizzle/0001_b.sql", "tag": "0001_b", "index": 1},
		],
		[{"idx": 0, "tag": "0000_a", "when": 100}, {"idx": 1, "tag": "0001_b", "when": 200}],
	)
	warned := policy.warn with input as facts
	not "migration_when_increases" in {w.rule | some w in warned}
}

# A `when` that goes backwards is the same skip as one that repeats.
test_a_decreasing_when_is_reported_too if {
	facts := migrations(
		[
			{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0},
			{"file": "apps/backend/drizzle/0001_b.sql", "tag": "0001_b", "index": 1},
		],
		[{"idx": 0, "tag": "0000_a", "when": 500}, {"idx": 1, "tag": "0001_b", "when": 400}],
	)
	warned := policy.warn with input as facts
	some v in warned
	v.rule == "migration_when_increases"
}

# --- rule 2, credential inventory ------------------------------------------

# Every column schema.ts documents as secret-bearing produces a fact, not only the
# ones #144 leaked. A column that is absent from the inventory is not "allowed" —
# it is invisible, which is worse, because nobody can allowlist what nobody sees.
test_the_credentials_TOTP_and_the_registry_added_are_checked if {
	columns := ["tokenHash", "secret", "pendingSecret", "codeHash", "credential"]
	every column in columns {
		facts := {"selects": [{
			"file": "apps/backend/src/lib/services/reports.ts",
			"line": 12,
			"columns": [sprintf("x: t.%s", [column])],
			"secretColumns": [column],
		}]}
		denied := policy.deny with input as facts
		count([v | some v in denied; v.rule == "no_secret_column_in_select"]) == 1
	}
}
