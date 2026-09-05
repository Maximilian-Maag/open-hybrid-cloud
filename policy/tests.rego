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

# ---------------------------------------------------------------------------
# rule 19 — a skip says why it skipped
# ---------------------------------------------------------------------------

# The other half of rule 13, and the reason that rule can afford its exemption.
#
# Rule 13 lets a test off for calling `test.skip()`, on the grounds that saying
# it did not run is honest. That only holds if the skip actually says something.
# 63 of the 64 skips in this suite are bare:
#
#     if (await noProducts.isVisible()) { test.skip(); return }
#
# which announces nothing. The report shows a skipped test and cannot tell a
# reader whether that was "no demo data on my laptop" or "the catalogue page is
# throwing 500s" — so rule 13's exemption is currently being spent on precisely
# the outcome it was written to discourage.
#
# It matters more since #285. The shards seed the database before they run, so in
# CI an empty catalogue is not an unmet precondition, it is a defect — and it is
# reported as a skip. #322 had to fix exactly this in `provisioning.spec.ts`,
# where a refused order, the regression the test existed to catch, came back
# green. #332 catalogues the rest.
#
# A WARN, not a deny, and deliberately: 63 existing violations would fail every
# build the day this lands, which is how a gate gets switched off rather than
# obeyed. It flips to deny when #332 clears them — the same staged approach #245
# takes with the mutation score.
warn contains v if {
	some c in input.skipCalls
	not c.hasReason

	v := {
		"rule": "skip_says_why",
		"file": c.file,
		"line": c.line,
		"detail": sprintf("`%s` skips without a reason", [c.text]),
		"why": concat("", [
			"A skip with no message is invisible in the report: it cannot distinguish an unmet ",
			"precondition from a broken page, and since #285 seeded the CI database the second is the ",
			"likelier one. Give it the reason — `test.skip(true, 'no product tile on /catalog')` — and ",
			"where the database IS seeded, fail instead of skipping, which is what #322 did for ",
			"provisioning.spec.ts. See #332.",
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
