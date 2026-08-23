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
	facts := migrations([], [{"idx": 0, "tag": "0000_a"}])
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "migration_matches_journal"
	contains(v.detail, "0000_a")
}

test_idx_disagreeing_with_the_filename_is_denied if {
	facts := migrations(
		[{"file": "apps/backend/drizzle/0003_a.sql", "tag": "0003_a", "index": 3}],
		[{"idx": 7, "tag": "0003_a"}],
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
		[{"idx": 0, "tag": "0000_a"}, {"idx": 1, "tag": "0001_b"}],
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
		[{"idx": 0, "tag": "0000_a"}, {"idx": 2, "tag": "0002_c"}],
	)
	denied := policy.deny with input as facts
	warned := policy.warn with input as facts
	count(denied) == 0
	some v in warned
	v.rule == "migration_numbering_is_contiguous"
	contains(v.detail, "gap at 1")
}
