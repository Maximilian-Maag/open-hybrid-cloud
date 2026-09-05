package repo.policy_test

import data.repo.policy

cases(list) := {"testCases": list}

test_a_test_with_no_assertion_is_denied if {
	facts := cases([{
		"file": "e2e/orders.spec.ts",
		"line": 47,
		"title": "order rows link to the order",
		"asserts": false,
		"skipped": false,
	}])
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "test_asserts_something"
	v.file == "e2e/orders.spec.ts"
	v.line == 47
	contains(v.detail, "can pass without checking anything")
	contains(v.why, "#154")
}

test_a_test_that_asserts_passes if {
	facts := cases([{"file": "a.test.ts", "line": 1, "title": "x", "asserts": true, "skipped": false}])
	denied := policy.deny with input as facts
	count(denied) == 0
}

# Announcing that it did not run is the behaviour this rule wants more of.
# `a11y.spec.ts` skips with a reason, and #154 names it as the pattern to copy.
test_a_test_that_skips_is_not_denied if {
	facts := cases([{"file": "a.spec.ts", "line": 1, "title": "needs demo data", "asserts": false, "skipped": true}])
	denied := policy.deny with input as facts
	count(denied) == 0
}

test_the_message_names_the_test if {
	facts := cases([{"file": "a.spec.ts", "line": 9, "title": "clicking a category filters the list", "asserts": false, "skipped": false}])
	denied := policy.deny with input as facts
	some v in denied
	contains(v.detail, "clicking a category filters the list")
}

# Every empty test, not just the first: the audit found ten at once.
test_every_empty_test_is_reported if {
	facts := cases([
		{"file": "a.spec.ts", "line": 1, "title": "one", "asserts": false, "skipped": false},
		{"file": "b.spec.ts", "line": 2, "title": "two", "asserts": false, "skipped": false},
		{"file": "c.spec.ts", "line": 3, "title": "three", "asserts": true, "skipped": false},
	])
	denied := policy.deny with input as facts
	count(denied) == 2
}

test_alert_query_is_scoped_flags_the_unscoped_form if {
	facts := {"unscopedAlertQueries": [{
		"file": "e2e/costs.spec.ts",
		"line": 42,
		"text": "await expect(page.getByRole('alert')).toBeVisible()",
	}]}
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "alert_query_is_scoped"
	v.file == "e2e/costs.spec.ts"
	v.line == 42
	contains(v.detail, "route announcer")
	contains(v.why, "pageAlerts(page)")
}

test_alert_query_is_scoped_is_silent_when_the_suite_is_clean if {
	denied := policy.deny with input as {"unscopedAlertQueries": []}
	count(denied) == 0
}
