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

# A dynamic route used to WARN, because a static path list could not name it and
# there was no seeded record to point at. #285 seeded the database and #223 added
# `DETAIL_PAGES`, which lists the route pattern and resolves a real URL at run
# time — so the shape is expressible now and this denies like any other page.
test_uncovered_dynamic_page_is_denied if {
	input_facts := facts([page("/orders/[id]", true, false)])
	denied := policy.deny with input as input_facts
	count(denied) == 1
	some v in denied
	v.rule == "page_is_in_the_a11y_gate"
	contains(v.detail, "dynamic segment")
	contains(v.why, "DETAIL_PAGES")
	warned := policy.warn with input as input_facts
	count(warned) == 0
}

# Covering a dynamic page — its route pattern in DETAIL_PAGES — is the way out,
# and it is the same way out a static page has.
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
