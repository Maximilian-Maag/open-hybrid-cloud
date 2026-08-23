# Rules about the schema, the migrations, and the test setup that has to agree
# with both of them.
package repo.policy

# ---------------------------------------------------------------------------
# rule 2 — no secret column in a hand-written select() projection
# ---------------------------------------------------------------------------

# Reads of a credential column that are deliberate, keyed by file and column so
# that a *second* secret read in an already-listed file is still reported.
#
# A bare `.select()` is not checked at all: it is unavoidably a whole-row read,
# there are dozens, and flagging them would bury the signal. What #144 actually
# was is a hand-written projection that reached one column further than the
# caller needed — which is what a named projection makes visible.
intentional_secret_reads := {
	"apps/backend/src/lib/db/queries.ts accessToken": "the CI source's API token, sent as the PRIVATE-TOKEN header to GitLab; never returned to a portal client",
	"apps/backend/src/lib/ci/webhooks.ts webhookToken": "the pipeline trigger token, sent to the CI provider to start a pipeline",
	"apps/backend/src/lib/services/auth.ts passwordHash": "bcrypt.compare for a password change; the hash is compared and discarded",
	"apps/backend/src/lib/services/admin/environments.ts callbackSecret": "the root-gated reveal endpoint — the operator has to be able to read the secret they must paste into the CI system",
	"apps/backend/src/app/api/webhooks/github/workflow/route.ts callbackSecret": "verifies the HMAC of an incoming callback against the environment's own secret",
	"apps/backend/src/app/api/webhooks/bitbucket/pipeline/route.ts callbackSecret": "verifies the HMAC of an incoming callback against the environment's own secret",
}

deny contains v if {
	some s in input.selects
	some column in s.secretColumns
	not intentional_secret_reads[sprintf("%s %s", [s.file, column])]

	v := {
		"rule": "no_secret_column_in_select",
		"file": s.file,
		"line": s.line,
		"detail": sprintf("projection names `%s`, which holds a credential", [column]),
		"why": concat("", [
			"A column added to a projection travels wherever that projection's rows go, and #144 was ",
			"exactly that: provider tokens reached error bodies, the audit log and admin reads because ",
			"a select grew one field. Drop the column, or add `<file> <column>` to `intentional_secret_reads` ",
			"in policy/database.rego with the reason it never leaves the process.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 3 — every table is in src/test/setup.ts, in both places
# ---------------------------------------------------------------------------

# The DDL half is a deny: a table missing from it does not exist in the test
# database, so every test touching it fails immediately and loudly.
deny contains v if {
	some table in input.tables
	not table.inTestDdl

	v := {
		"rule": "table_in_test_setup",
		"file": input.testSetupFile,
		"line": 0,
		"detail": sprintf("`%s` is declared in %s but has no CREATE TABLE here", [table.name, input.schemaFile]),
		"why": concat("", [
			"src/test/setup.ts is a hand-maintained third copy of the schema (#147). A table that is not ",
			"created here does not exist in the test database, and every test that touches it fails with ",
			"a relation-does-not-exist error that reads like a connection problem.",
		]),
	}
}

# The TRUNCATE half is a warn until #147 lands: `branding` and `app_config` are
# in the DDL and missing from TABLES on dev today. This is the quieter failure of
# the two — the table simply never gets emptied between tests, so a suite passes
# alone and fails in a full run.
warn contains v if {
	some table in input.tables
	table.inTestDdl
	not table.inTestTables

	v := {
		"rule": "table_in_test_setup",
		"file": input.testSetupFile,
		"line": 0,
		"detail": sprintf("`schema.%s` is created here but is not in the TABLES list, so it is never truncated", [table.export]),
		"why": concat("", [
			"Rows left behind leak into the next test. The symptom is a test that passes on its own and ",
			"fails in a full run, or vice versa, which is the most expensive kind of failure to chase. ",
			"Deny once #147 makes this file stop being a third schema definition.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 4 — migrations and the journal agree
# ---------------------------------------------------------------------------

journal_tags := {entry.tag | some entry in input.migrations.journal}

migration_tags := {file.tag | some file in input.migrations.files}

deny contains v if {
	some file in input.migrations.files
	not journal_tags[file.tag]

	v := {
		"rule": "migration_matches_journal",
		"file": file.file,
		"line": 0,
		"detail": sprintf("no entry for %q in %s", [file.tag, input.migrations.journalFile]),
		"why": concat("", [
			"drizzle-kit applies what the journal lists, not what the directory holds. A .sql file with no ",
			"entry is never run: the app boots against a database missing the change, and fails at the first ",
			"query that needs it.",
		]),
	}
}

deny contains v if {
	some entry in input.migrations.journal
	not migration_tags[entry.tag]

	v := {
		"rule": "migration_matches_journal",
		"file": input.migrations.journalFile,
		"line": 0,
		"detail": sprintf("entry %d names %q, and there is no such .sql file", [entry.idx, entry.tag]),
		"why": "drizzle-kit stops at the first entry whose file it cannot read, so every later migration is skipped too.",
	}
}

deny contains v if {
	some file in input.migrations.files
	some entry in input.migrations.journal
	entry.tag == file.tag
	entry.idx != file.index

	v := {
		"rule": "migration_matches_journal",
		"file": file.file,
		"line": 0,
		"detail": sprintf("filename says %04d, journal entry says idx %d", [file.index, entry.idx]),
		"why": "The journal's idx decides the order migrations run in; a filename that disagrees makes the directory listing lie about it.",
	}
}

# Gaps are a warn and will stay one. There are three on dev (17, 18, 21), left by
# migrations that were generated and deleted before release. Closing them means
# renumbering migrations that have already been applied to real databases, which
# is a worse problem than the one it solves. What the gap is still worth saying
# is that `pnpm db:generate` produced something that was thrown away — the
# opening move of #141.
warn contains v if {
	some entry in input.migrations.journal
	entry.idx > 0
	previous := entry.idx - 1
	not journal_idx[previous]

	v := {
		"rule": "migration_numbering_is_contiguous",
		"file": input.migrations.journalFile,
		"line": 0,
		"detail": sprintf("idx %d follows a gap at %d", [entry.idx, previous]),
		"why": concat("", [
			"A gap means a migration was generated and then removed. Harmless once released — renumbering ",
			"applied migrations would be worse — but it is how #141 starts, so it is worth seeing.",
		]),
	}
}

journal_idx := {entry.idx | some entry in input.migrations.journal}
