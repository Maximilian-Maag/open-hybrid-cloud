package repo.policy_test

import data.repo.policy

# --- rule 9 ----------------------------------------------------------------

silent(file, documented) := {"silentCatches": [{
	"file": file,
	"line": 254,
	"kind": ".catch(() => {})",
	"documented": documented,
}]}

test_undocumented_backend_catch_is_denied if {
	facts := silent("apps/backend/src/lib/services/orders.ts", false)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "silent_catch_is_documented"
	v.line == 254
	contains(v.why, "#136")

	# The message says where to put the reason, not just that one is missing.
	contains(v.why, "inside the braces")
}

test_undocumented_frontend_catch_is_denied_too if {
	facts := silent("apps/frontend/src/app/login/page.tsx", false)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "silent_catch_is_documented"
}

test_a_documented_catch_passes_on_either_side if {
	backend := silent("apps/backend/src/lib/services/orders.ts", true)
	frontend := silent("apps/frontend/src/app/login/page.tsx", true)
	backend_denied := policy.deny with input as backend
	frontend_denied := policy.deny with input as frontend
	count(backend_denied) == 0
	count(frontend_denied) == 0
}

# --- rule 12 ---------------------------------------------------------------

logs(file, namesAValue) := {"consoleCalls": [{
	"file": file,
	"line": 60,
	"method": "error",
	"message": "'[orders] Could not start element'",
	"namesAValue": namesAValue,
}]}

test_a_log_about_an_order_that_names_no_id_warns if {
	facts := logs("apps/backend/src/lib/services/orders.ts", false)
	warned := policy.warn with input as facts
	denied := policy.deny with input as facts
	count(denied) == 0
	some v in warned
	v.rule == "log_names_the_record"
	contains(v.why, "#116")
}

test_a_log_that_interpolates_an_id_passes if {
	facts := logs("apps/backend/src/lib/services/orders.ts", true)
	warned := policy.warn with input as facts
	count(warned) == 0
}

# "Default branding created" has no record to name, and reporting it forever is
# how a warn stops being read.
test_bootstrap_logs_are_out_of_scope if {
	facts := logs("apps/backend/src/lib/bootstrap/index.ts", false)
	warned := policy.warn with input as facts
	count(warned) == 0
}

test_webhook_and_ci_modules_are_in_scope if {
	webhook := logs("apps/backend/src/lib/webhook/handler.ts", false)
	ci := logs("apps/backend/src/lib/ci/gitlab.ts", false)
	webhook_warned := policy.warn with input as webhook
	ci_warned := policy.warn with input as ci
	count(webhook_warned) == 1
	count(ci_warned) == 1
}
