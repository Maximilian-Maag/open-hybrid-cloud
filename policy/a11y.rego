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

# A dynamic page cannot be named by a static path — `/orders/[id]` needs a real
# order to exist first — so it warns rather than denies. The hole is real: five
# of this app's pages, including every detail view, are outside the gate. Closing
# it means seeding a record and visiting its URL, which is what the rest of the
# e2e suite already does; the point of the warning is that the gap is stated
# rather than implied by the list's silence.
warn contains v if {
	some page in input.pages
	page.dynamic
	not page.inA11ySpec

	v := {
		"rule": "page_is_in_the_a11y_gate",
		"file": page.file,
		"detail": sprintf("%s takes a dynamic segment, so the static path list cannot reach it", [page.routePath]),
		"why": concat("", [
			"Detail pages are where the tables, forms and status panels live, so they are the pages ",
			"most likely to have an accessibility defect and the ones the gate cannot name. Covering ",
			"one means seeding a record in the e2e database and visiting its URL — the rest of the ",
			"suite already does exactly that. Deny once every detail page has a seeded fixture.",
		]),
	}
}
