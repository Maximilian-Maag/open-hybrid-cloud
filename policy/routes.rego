# Rules about `apps/backend/src/app/api/**/route.ts`.
package repo.policy

# ---------------------------------------------------------------------------
# rule 1 — every route authenticates, or is on this list
# ---------------------------------------------------------------------------

# The routes that answer without a user session, and what stands in for one.
#
# Exact paths, not `public/*` and `webhooks/*` globs: a new endpoint under
# `webhooks/` is exactly the kind of thing that should cost a line in this file
# and a sentence in a review, rather than inheriting an exemption by living in
# the right directory.
public_routes := {
	"health": "the container health probe and the e2e readiness gate — it has to answer before anything is configured",
	"auth/login": "issues the session; requiring one would be the login endpoint that demands a login",
	"auth/callback": "the SSO redirect target; the identity provider is the caller and it carries no portal session",
	"public/branding": "the login screen renders from it, before any session exists",
	"public/exchange-rates": "read by the unauthenticated shell for price display",
	"catalog/[id]/image": "loaded by the browser as an <img> src, which cannot carry a bearer token",
	"webhooks/gitlab/pipeline": "authenticated by the environment's callback_secret over HMAC, not by a session",
	"webhooks/github/workflow": "authenticated by the environment's callback_secret over HMAC, not by a session",
	"webhooks/bitbucket/pipeline": "authenticated by the environment's callback_secret over HMAC, not by a session",
	"internal/decommission-sweep": "driven by a scheduler with no user to be; authenticated by DECOMMISSION_SWEEP_SECRET and disabled outright when it is unset",
}

deny contains v if {
	some route in input.routes
	count(route.methods) > 0
	count(route.authHelpers) == 0
	not public_routes[route.apiPath]

	v := {
		"rule": "route_requires_auth",
		"file": route.file,
		"line": 0,
		"detail": sprintf(
			"exports %s but never calls requireAuth or requireRole, and %q is not on the public allowlist",
			[concat(", ", route.methods), route.apiPath],
		),
		"why": concat("", [
			"Whether a route authenticates is not visible in the file a reviewer is reading — ",
			"it is the absence of a call. #131 and the two IDOR fixes before it were all this shape. ",
			"If the endpoint really is public, add it to `public_routes` in policy/routes.rego with the reason; ",
			"that makes the exemption a reviewable diff instead of an oversight.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 5 — route ids go through parseRouteId
# ---------------------------------------------------------------------------

deny contains v if {
	some route in input.routes
	some parse in route.unsafeIdParses

	v := {
		"rule": "route_id_parsed_safely",
		"file": route.file,
		"line": parse.line,
		"detail": sprintf("`%s` reads the `%s` path segment without parseRouteId", [parse.call, parse.segment]),
		"why": concat("", [
			"`parseInt('5abc')` is 5 and `Number('0x10')` is 16, so a malformed id resolves to a real row ",
			"the caller never named — that was #143. `parseRouteId` from lib/http.ts is digits-only and ",
			"safe-integer checked; pair it with `invalidId('...')` for the 400.",
		]),
	}
}

deny contains v if {
	some route in input.routes
	count(route.dynamicSegments) > 0
	route.safeIdParses == 0
	count(route.unsafeIdParses) == 0

	v := {
		"rule": "route_id_parsed_safely",
		"file": route.file,
		"line": 0,
		"detail": sprintf("has path segments %s but never calls parseRouteId", [concat(", ", route.dynamicSegments)]),
		"why": concat("", [
			"A dynamic segment arrives as an arbitrary string. Reaching the database with it unvalidated is ",
			"how #143's `parseInt` bugs got their reach; `parseRouteId` is the one place that decides what an id is.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 10 — every route is exercised by a route test
# ---------------------------------------------------------------------------

# Warn, not deny, until #181 adds the two missing tests.
warn contains v if {
	some route in input.routes
	count(route.methods) > 0
	count(route.testFiles) == 0

	v := {
		"rule": "route_has_a_test",
		"file": route.file,
		"line": 0,
		"detail": sprintf("no route.test.ts imports this module (exports %s)", [concat(", ", route.methods)]),
		"why": concat("", [
			"The service underneath is usually tested; the HTTP surface — the role check, the id parsing, ",
			"the Zod schema, the status codes — is what goes untested and what breaks. ",
			"Deny once #181 closes. Membership is by import edge, not by sibling filename, because ",
			"sessions/route.test.ts legitimately covers sessions/[id]/route.ts from one directory over.",
		]),
	}
}

# ---------------------------------------------------------------------------
# rule 11 — advisory size limit
# ---------------------------------------------------------------------------

# Deliberately a warn and deliberately only half of what #149 asked for. The
# other half — "a service function with more than one responsibility" — is not
# mechanically decidable, and a rule that pretended to decide it would be worse
# than no rule. 150 is a guess, calibrated so it reports the two route files that
# already do their own CSV assembly and their own rate limiting inline.
max_route_lines := 150

warn contains v if {
	some route in input.routes
	route.lines > max_route_lines

	v := {
		"rule": "route_file_is_small",
		"file": route.file,
		"line": 0,
		"detail": sprintf("%d lines (advisory limit %d)", [route.lines, max_route_lines]),
		"why": concat("", [
			"A route should parse, authorise and delegate. Past this length it is usually doing the work ",
			"itself, which puts logic behind an HTTP boundary where only an integration test can reach it. ",
			"The threshold is a guess, which is why this never fails a build.",
		]),
	}
}
