package repo.policy_test

import data.repo.policy

# --- rule 6 ----------------------------------------------------------------

action(uses, ref, local) := {"actionRefs": [{
	"file": ".github/workflows/ci.yml",
	"line": 26,
	"uses": uses,
	"action": "actions/checkout",
	"ref": ref,
	"local": local,
}]}

test_action_pinned_to_a_tag_is_denied if {
	facts := action("actions/checkout@v4", "v4", false)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "action_pinned_to_sha"
	v.file == ".github/workflows/ci.yml"
	v.line == 26
	contains(v.detail, "\"v4\"")
	contains(v.why, "secrets")
}

test_action_pinned_to_a_sha_passes if {
	facts := action(
		"actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
		"34e114876b0b11c390a56381ad16ebd13914f8d5",
		false,
	)
	denied := policy.deny with input as facts
	count(denied) == 0
}

# A composite action in this repository is reviewed with the repository.
test_local_action_is_not_checked if {
	facts := action("./.github/actions/setup", "", true)
	denied := policy.deny with input as facts
	count(denied) == 0
}

test_action_with_no_ref_at_all_is_denied if {
	facts := action("actions/checkout", "", false)
	denied := policy.deny with input as facts
	some v in denied
	v.rule == "action_pinned_to_sha"
	contains(v.detail, "nothing")
}

# A branch name is 40 characters of nothing in particular, but not hex.
test_a_forty_character_branch_name_is_still_denied if {
	name := "not-a-sha-not-a-sha-not-a-sha-not-a-shaX"
	facts := action(sprintf("actions/checkout@%s", [name]), name, false)
	denied := policy.deny with input as facts
	count(denied) == 1
}

# --- rule 7 ----------------------------------------------------------------

image(name, tag, interpolated) := {"imageRefs": [{
	"file": "infra/docker-compose.dev.yml",
	"line": 51,
	"image": sprintf("%s:%s", [name, tag]),
	"name": name,
	"tag": tag,
	"interpolated": interpolated,
}]}

test_latest_warns_and_never_denies if {
	facts := image("wiremock/wiremock", "latest", false)
	warned := policy.warn with input as facts
	denied := policy.deny with input as facts
	count(denied) == 0
	some v in warned
	v.rule == "image_tag_is_pinned"
	v.line == 51
	contains(v.why, "#180")
}

test_an_absent_tag_warns_and_says_why if {
	facts := image("axllent/mailpit", "", false)
	warned := policy.warn with input as facts
	some v in warned
	v.rule == "image_tag_is_pinned"
	contains(v.detail, "carries no tag")
}

test_a_pinned_tag_passes if {
	facts := image("structurizr/lite", "2025.11.08", false)
	warned := policy.warn with input as facts
	count(warned) == 0
}

# Deliberate: these float only inside a version line, and reporting them would
# make the list long enough to ignore.
test_alpine_style_tags_are_not_reported if {
	facts := image("postgres", "16-alpine", false)
	warned := policy.warn with input as facts
	count(warned) == 0
}

test_an_interpolated_tag_defaulting_to_latest_warns_once if {
	facts := {"imageRefs": [{
		"file": "infra/docker-host/docker-compose.yml",
		"line": 29,
		"image": "acme/frontend:${IMAGE_TAG:-latest}",
		"name": "acme/frontend",
		"tag": "${IMAGE_TAG:-latest}",
		"interpolated": true,
	}]}
	warned := policy.warn with input as facts
	count(warned) == 1
	some v in warned
	contains(v.detail, "falls back to `latest`")
}

test_an_interpolated_tag_with_a_pinned_default_passes if {
	facts := {"imageRefs": [{
		"file": "infra/docker-host/docker-compose.yml",
		"line": 29,
		"image": "acme/frontend:${IMAGE_TAG:-1.4.0}",
		"name": "acme/frontend",
		"tag": "${IMAGE_TAG:-1.4.0}",
		"interpolated": true,
	}]}
	warned := policy.warn with input as facts
	count(warned) == 0
}
