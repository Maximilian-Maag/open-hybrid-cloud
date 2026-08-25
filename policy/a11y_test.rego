package repo.policy_test

import data.repo.policy

page(route, dynamic, covered) := {
	"file": sprintf("apps/frontend/src/app%s/page.tsx", [route]),
	"routePath": route,
	"dynamic": dynamic,
	"inA11ySpec": covered,
}

facts(pages) := {"pages": pages, "a11ySpecFile": "e2e/a11y.spec.ts"}

test_static_page_missing_from_the_list_denies if {
	denied := policy.deny with input as facts([page("/settings", false, false)])
	count(denied) == 1
	some v in denied
	v.rule == "page_is_in_the_a11y_gate"
	contains(v.detail, "/settings")
	contains(v.detail, "e2e/a11y.spec.ts")
}

test_static_page_on_the_list_is_clean if {
	denied := policy.deny with input as facts([page("/settings", false, true)])
	count(denied) == 0
	warned := policy.warn with input as facts([page("/settings", false, true)])
	count(warned) == 0
}

# A dynamic route has no single static URL, so the list cannot name it. It is a
# real gap and it warns — but it must never fail a build for a shape that cannot
# be expressed in the list it is being compared against.
test_dynamic_page_warns_rather_than_denies if {
	input_facts := facts([page("/orders/[id]", true, false)])
	denied := policy.deny with input as input_facts
	count(denied) == 0
	warned := policy.warn with input as input_facts
	count(warned) == 1
	some v in warned
	v.rule == "page_is_in_the_a11y_gate"
}

# Covering a dynamic page — a seeded fixture whose exact path is listed — is the
# way out of the warning, not a permanent exemption.
test_covered_dynamic_page_is_clean if {
	input_facts := facts([page("/orders/[id]", true, true)])
	denied := policy.deny with input as input_facts
	count(denied) == 0
	warned := policy.warn with input as input_facts
	count(warned) == 0
}

test_the_root_page_is_treated_like_any_other if {
	denied := policy.deny with input as facts([page("/", false, false)])
	count(denied) == 1
}
