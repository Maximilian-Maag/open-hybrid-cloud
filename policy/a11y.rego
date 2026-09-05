# Rules about what the accessibility gate actually looks at.
package repo.policy

# ---------------------------------------------------------------------------
# rule 14 — every page is in the accessibility gate
# ---------------------------------------------------------------------------

# The axe gate in `e2e/a11y.spec.ts` visits a hand-written list of paths. A page
# added without touching that list is simply never checked, and — this is the
# part that makes it a policy rule rather than a code review note — nothing says
# so. The suite reports the same number of green a11y assertions it reported
# before the page existed, so the gate silently stops covering the app while
# continuing to look like it does.
#
# That is the same failure shape as #154's tests that assert nothing: coverage
# that shrinks without anybody being told. The difference is that here it can be
# decided exactly, by comparing the route tree against the list.
deny contains v if {
	some page in input.pages
	not page.dynamic
	not page.inA11ySpec

	v := {
		"rule": "page_is_in_the_a11y_gate",
		"file": page.file,
		"detail": sprintf("%s is not in the axe path list in %s", [page.routePath, input.a11ySpecFile]),
		"why": concat("", [
			"The accessibility gate visits a hand-written list of paths, so a page that is not on it ",
			"is never scanned — and the suite still reports the same green result, which is why this ",
			"goes unnoticed. Add the route to AUTHED_PAGES (or PUBLIC_PAGES if it needs no session). ",
			"The app claims partial AAA conformance in docs/guides/accessibility.md; a page nobody ",
			"scanned is not covered by that claim.",
		]),
	}
}

# A dynamic page used to warn rather than deny, because a static path list cannot
# name `/orders/[id]` and there was no seeded order to point at. Both halves of
# that changed: #285 seeds the e2e database, and #223 added `DETAIL_PAGES`, which
# lists the ROUTE PATTERN and resolves a real URL from the list page at run time.
# All five are covered, so this denies like any other page — the exit condition
# the warning named.
deny contains v if {
	some page in input.pages
	page.dynamic
	not page.inA11ySpec

	v := {
		"rule": "page_is_in_the_a11y_gate",
		"file": page.file,
		"detail": sprintf("%s takes a dynamic segment and is in no path list", [page.routePath]),
		"why": concat("", [
			"Detail pages are where the tables, forms and status panels live, so they are the pages ",
			"most likely to have an accessibility defect — and the ones a static list cannot name. ",
			"Add the route PATTERN to DETAIL_PAGES and an entry to DETAIL_FIXTURES saying which list ",
			"page links to it; the test finds a real URL from there. A page nobody scanned is not ",
			"covered by the partial AAA conformance docs/guides/accessibility.md claims.",
		]),
	}
}
