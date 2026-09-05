# Rules about the tests themselves.
package repo.policy

# ---------------------------------------------------------------------------
# rule 13 — a test asserts something
# ---------------------------------------------------------------------------

# #154 catalogued ten e2e tests that report green having verified nothing: bodies
# that are entirely `if (await x.isVisible()) { … }` with no `else`, a bare
# `return` on an empty locator, a tautology like `expect(count > 0 || isEmpty)`.
# They were found by reading every spec line by line, which is not a thing anyone
# will do twice.
#
# The failure mode is the worst kind a suite has: it gets bigger, the report stays
# green, and the coverage is imaginary. A test that cannot fail is worse than a
# missing one, because a missing one is visible.
#
# This is the mechanical half of that audit and it is deliberately modest. It
# cannot judge whether an assertion means anything — `expect(true).toBe(true)`
# passes it — but "contains no assertion at all" is decidable, and that is the case
# that recurs. `scripts/policy-facts.ts` counts an `expect`, an `expect`-named
# helper, a Playwright wait that throws, and a helper defined in the same file
# whose own body asserts.
#
# A test that calls `test.skip()` is exempt. Announcing that it did not run is the
# honest behaviour this rule wants more of, not less — `a11y.spec.ts` skips with a
# reason, and that is the pattern #154 points at.
deny contains v if {
	some test in input.testCases
	not test.asserts
	not test.skipped

	v := {
		"rule": "test_asserts_something",
		"file": test.file,
		"line": test.line,
		"detail": sprintf("%q can pass without checking anything", [test.title]),
		"why": concat("", [
			"A test that cannot fail is worse than no test: it makes the suite look bigger and the ",
			"coverage is imaginary. #154 found ten of these by reading every spec by hand. Assert what ",
			"the test is named after — or, if it genuinely cannot run here, call `test.skip()` with a ",
			"reason, which is honest and which this rule allows.",
		]),
	}
}

# `page.getByRole('alert')` in an e2e spec, which cannot resolve to one element.
#
# Next's App Router renders `<div role="alert" id="__next-route-announcer__">`
# into every page to announce client-side navigations. It is always there and it
# is empty, so a document-level alert query is a strict mode violation waiting
# for the first test that reaches it — and Playwright reports that as "resolved
# to 2 elements", naming the locator and not the cause.
#
# It cost a debugging session on the costs dashboard. `pageAlerts(page)` in
# `e2e/helpers.ts` excludes the announcer and is the fix. A locator that is
# already scoped — `dialog.getByRole('alert')`, or a `.filter({ hasText: … })` —
# is not reported, which is how the legitimate uses in this suite are written.
deny contains v if {
	some q in input.unscopedAlertQueries

	v := {
		"rule": "alert_query_is_scoped",
		"file": q.file,
		"line": q.line,
		"detail": sprintf("`%s` also matches Next's route announcer", [q.text]),
		"why": concat("", [
			"Every page carries `<div role=\"alert\" id=\"__next-route-announcer__\">`, so this locator ",
			"matches at least two elements and fails in strict mode with a message about the count ",
			"rather than about the alert. Use `pageAlerts(page)` from `e2e/helpers.ts`, which excludes ",
			"the announcer, or scope the query to the container the alert renders in.",
		]),
	}
}
