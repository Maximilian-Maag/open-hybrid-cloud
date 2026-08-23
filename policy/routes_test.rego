package repo.policy_test

import data.repo.policy

# A route that satisfies every rule in routes.rego, so each test below changes
# exactly one thing and the failure names itself.
clean_route := {
	"file": "apps/backend/src/app/api/orders/route.ts",
	"apiPath": "orders",
	"methods": ["GET"],
	"authHelpers": ["requireAuth"],
	"dynamicSegments": [],
	"lines": 40,
	"safeIdParses": 0,
	"unsafeIdParses": [],
	"testFiles": ["apps/backend/src/app/api/orders/route.test.ts"],
}

rules(violations) := {v.rule | some v in violations}

# --- rule 1 ----------------------------------------------------------------

test_route_without_auth_is_denied if {
	route := object.union(clean_route, {"authHelpers": []})
	denied := policy.deny with input as {"routes": [route]}
	"route_requires_auth" in rules(denied)
}

test_route_with_requireRole_is_allowed if {
	route := object.union(clean_route, {"authHelpers": ["requireRole"]})
	denied := policy.deny with input as {"routes": [route]}
	not "route_requires_auth" in rules(denied)
}

test_allowlisted_route_is_allowed if {
	route := object.union(clean_route, {"apiPath": "health", "authHelpers": []})
	denied := policy.deny with input as {"routes": [route]}
	not "route_requires_auth" in rules(denied)
}

# A route module that exports no handler is a helper, not an endpoint.
test_route_with_no_methods_is_not_checked if {
	route := object.union(clean_route, {"authHelpers": [], "methods": []})
	denied := policy.deny with input as {"routes": [route]}
	count(denied) == 0
}

test_violation_names_the_file_and_the_reason if {
	route := object.union(clean_route, {"authHelpers": []})
	denied := policy.deny with input as {"routes": [route]}
	some v in denied
	v.rule == "route_requires_auth"
	v.file == "apps/backend/src/app/api/orders/route.ts"
	contains(v.detail, "orders")
	contains(v.why, "#131")
}

# --- rule 5 ----------------------------------------------------------------

test_parseInt_on_a_path_segment_is_denied if {
	route := object.union(clean_route, {
		"dynamicSegments": ["[id]"],
		"safeIdParses": 0,
		"unsafeIdParses": [{"line": 12, "call": "parseInt(id, 10)", "segment": "id"}],
	})
	denied := policy.deny with input as {"routes": [route]}
	"route_id_parsed_safely" in rules(denied)

	# The unsafe-parse rule fires; the never-called rule must not double-report.
	count(denied) == 1
}

test_dynamic_route_that_never_parses_an_id_is_denied if {
	route := object.union(clean_route, {"dynamicSegments": ["[id]"], "safeIdParses": 0})
	denied := policy.deny with input as {"routes": [route]}
	"route_id_parsed_safely" in rules(denied)
}

test_parseRouteId_satisfies_rule_5 if {
	route := object.union(clean_route, {"dynamicSegments": ["[id]"], "safeIdParses": 1})
	denied := policy.deny with input as {"routes": [route]}
	count(denied) == 0
}

# `parseInt(searchParams.get('scopeId'))` is a query parameter, not a path id;
# the extractor only records bindings destructured from `params`, so a static
# route has nothing for rule 5 to check.
test_static_route_is_not_checked_for_ids if {
	denied := policy.deny with input as {"routes": [clean_route]}
	count(denied) == 0
}

# --- rule 10 ---------------------------------------------------------------

test_route_without_a_test_warns_and_never_denies if {
	route := object.union(clean_route, {"testFiles": []})
	warned := policy.warn with input as {"routes": [route]}
	denied := policy.deny with input as {"routes": [route]}
	"route_has_a_test" in rules(warned)
	count(denied) == 0
	some v in warned
	contains(v.why, "#181")
}

test_route_covered_from_a_sibling_directory_passes if {
	route := object.union(clean_route, {
		"file": "apps/backend/src/app/api/sessions/[id]/route.ts",
		"apiPath": "sessions/[id]",
		"dynamicSegments": ["[id]"],
		"safeIdParses": 1,
		"testFiles": ["apps/backend/src/app/api/sessions/route.test.ts"],
	})
	warned := policy.warn with input as {"routes": [route]}
	count(warned) == 0
}

# --- rule 11 ---------------------------------------------------------------

test_long_route_warns_and_never_denies if {
	route := object.union(clean_route, {"lines": policy.max_route_lines + 1})
	warned := policy.warn with input as {"routes": [route]}
	denied := policy.deny with input as {"routes": [route]}
	"route_file_is_small" in rules(warned)
	count(denied) == 0
}

test_route_at_the_limit_is_fine if {
	route := object.union(clean_route, {"lines": policy.max_route_lines})
	warned := policy.warn with input as {"routes": [route]}
	count(warned) == 0
}
