# Rules about what a migration does to a table that already has rows in it.
package repo.policy

# ---------------------------------------------------------------------------
# rule 18 — a NOT NULL column has a value for the rows that already exist
# ---------------------------------------------------------------------------

# `ALTER TABLE t ADD COLUMN c text NOT NULL` succeeds on an empty database and
# fails on every other one, with `column "c" of relation "t" contains null
# values`. That asymmetry is the whole problem: it passes CI, it passes a fresh
# clone, it passes the reviewer's machine, and it fails once — on the deployment
# that has data, after release, with the migration already merged.
#
# Two spellings of the same mistake, so two blocks:
#
#   * ADD COLUMN … NOT NULL with no DEFAULT — Postgres has nothing to put in the
#     existing rows.
#   * ALTER COLUMN … SET NOT NULL with nothing earlier in the file that gives the
#     existing rows a value. `0004_add_callback_secret.sql` is the correct shape
#     to copy: add the column nullable, UPDATE to backfill it, then constrain.
#
# CREATE TABLE is not examined — a table being created has no rows, so every NOT
# NULL in it is free, and reporting them would bury the two cases that matter.
#
# Measured on dev when the rule was written: 24 ADD COLUMN clauses and 1
# ALTER COLUMN … SET NOT NULL across 27 migrations; 0 violations. The one
# SET NOT NULL is backfilled. A floor, not a cleanup — deny.
deny contains v if {
	some column in input.migrationColumns
	column.kind == "add"
	column.notNull
	not column.hasDefault

	v := {
		"rule": "migration_not_null_needs_a_value",
		"file": column.file,
		"line": column.line,
		"detail": sprintf(
			"adds `%s.%s` as NOT NULL with no DEFAULT, so it fails on any table that already has rows",
			[column.table, column.column],
		),
		"why": concat("", [
			"Postgres has to put something in the rows that are already there, and with no DEFAULT it ",
			"refuses the whole migration with `contains null values`. It passes on an empty database, so ",
			"it passes CI and a fresh clone and fails exactly once, on the deployment with data in it. ",
			"Give the column a DEFAULT, or add it nullable, UPDATE the existing rows and then SET NOT NULL ",
			"— apps/backend/drizzle/0004_add_callback_secret.sql is that shape.",
		]),
	}
}

deny contains v if {
	some column in input.migrationColumns
	column.kind == "setNotNull"
	not column.backfilled

	v := {
		"rule": "migration_not_null_needs_a_value",
		"file": column.file,
		"line": column.line,
		"detail": sprintf(
			"constrains `%s.%s` to NOT NULL and nothing earlier in this file gives the existing rows a value",
			[column.table, column.column],
		),
		"why": concat("", [
			"Tightening an existing nullable column is the same failure as adding one: any row still ",
			"holding NULL makes the ALTER refuse, on the deployment that has the data and nowhere else. ",
			"Put an UPDATE that fills the column above the constraint, or add the column with a DEFAULT in ",
			"the same file — apps/backend/drizzle/0004_add_callback_secret.sql does the first.",
		]),
	}
}
