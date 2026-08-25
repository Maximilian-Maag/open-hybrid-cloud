package repo.policy_test

import data.repo.policy

added(column, not_null, has_default) := {
	"file": "apps/backend/drizzle/0031_add_thing.sql",
	"line": 12,
	"table": "orders",
	"column": column,
	"kind": "add",
	"notNull": not_null,
	"hasDefault": has_default,
	"backfilled": false,
}

constrained(column, backfilled) := {
	"file": "apps/backend/drizzle/0031_add_thing.sql",
	"line": 20,
	"table": "orders",
	"column": column,
	"kind": "setNotNull",
	"notNull": true,
	"hasDefault": false,
	"backfilled": backfilled,
}

migration_facts(columns) := {"migrationColumns": columns}

test_not_null_with_no_default_is_denied if {
	denied := policy.deny with input as migration_facts([added("quantity", true, false)])
	count(denied) == 1
	some v in denied
	v.rule == "migration_not_null_needs_a_value"
	v.file == "apps/backend/drizzle/0031_add_thing.sql"
	v.line == 12
	contains(v.detail, "`orders.quantity`")
	contains(v.why, "contains null values")
}

test_not_null_with_a_default_passes if {
	denied := policy.deny with input as migration_facts([added("quantity", true, true)])
	count(denied) == 0
}

# The common and correct case: a nullable column needs nothing at all.
test_a_nullable_column_passes if {
	denied := policy.deny with input as migration_facts([added("owner", false, false)])
	count(denied) == 0
}

# The second spelling of the same mistake — tightening a column that already
# exists. This one is not about DEFAULT: the rows are already there.
test_set_not_null_without_a_backfill_is_denied if {
	denied := policy.deny with input as migration_facts([constrained("callback_secret", false)])
	count(denied) == 1
	some v in denied
	v.line == 20
	contains(v.detail, "nothing earlier in this file gives the existing rows a value")
}

# The shape 0004_add_callback_secret.sql actually uses, and the one the message
# tells people to copy: add nullable, UPDATE, then constrain. It must pass, or
# the rule is telling the tree to stop doing the right thing.
test_add_nullable_then_backfill_then_constrain_passes if {
	facts := migration_facts([added("callback_secret", false, false), constrained("callback_secret", true)])
	denied := policy.deny with input as facts
	count(denied) == 0
}

# Two faults in one file are two findings, because they are two separate edits.
test_two_bad_columns_in_one_file_are_two_findings if {
	facts := migration_facts([added("a", true, false), added("b", true, false)])
	denied := policy.deny with input as facts
	count(denied) == 2
}
