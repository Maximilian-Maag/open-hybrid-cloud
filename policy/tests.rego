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
