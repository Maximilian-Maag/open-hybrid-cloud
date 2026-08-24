# Codebase invariants for this repository, enforced in CI (issue #149).
#
# This bundle never runs in production. Its input is the JSON that
# `scripts/policy-facts.ts` extracts from the source tree, and its output is a
# failed pull-request check. The runtime order policies of #110 are a different
# bundle with a different input and must not be merged into this one.
#
# Every rule in this package contributes to `deny` or `warn`, so a new rule is
# one block in one file plus one test — nothing here needs updating for it.
#
# A violation is an object rather than a string because the runner has to print
# three things: which rule, which file, and *why the rule exists*. A policy
# failure that does not explain itself gets suppressed rather than fixed.
package repo.policy

# The whole verdict, in the shape `scripts/policy-check.ts` prints.
report := {
	"deny": [v | some v in deny],
	"warn": [v | some v in warn],
}
