# Rules about what CI and the compose stacks pull in from outside.
package repo.policy

# ---------------------------------------------------------------------------
# rule 6 — every third-party Action is pinned to a commit
# ---------------------------------------------------------------------------

deny contains v if {
	some ref in input.actionRefs
	ref.kind == "repo"
	not regex.match(`^[0-9a-f]{40}$`, ref.ref)

	v := {
		"rule": "action_pinned_to_sha",
		"file": ref.file,
		"line": ref.line,
		"detail": sprintf("`uses: %s` is pinned to %q, not to a commit", [ref.uses, pinned_as(ref)]),
		"why": concat("", [
			"A tag is a moving pointer the action's owner can repoint at any time, at which point their ",
			"code runs with this repository's secrets. Pin the 40-character SHA and keep the version in a ",
			"trailing comment: `uses: owner/action@<sha> # v4`. ",
			"This gate obeys the same rule — see the OPA install step in .github/workflows/ci.yml.",
		]),
	}
}

# `uses: docker://…` is not a local action and never was: it pulls a whole root
# filesystem from a registry and runs the step inside it. Treating it as local
# exempted `docker://vendor/image:latest` — a tag the vendor can repoint — from
# the rule that exists precisely to stop that. An image is immutable by digest,
# not by commit, so it is checked against the digest form instead.
deny contains v if {
	some ref in input.actionRefs
	ref.kind == "docker"
	not regex.match(`^sha256:[0-9a-f]{64}$`, ref.ref)

	v := {
		"rule": "action_pinned_to_sha",
		"file": ref.file,
		"line": ref.line,
		"detail": sprintf("`uses: %s` is pinned to %q, not to an image digest", [ref.uses, pinned_as(ref)]),
		"why": concat("", [
			"A `docker://` step runs a third party's container against this repository's secrets, and a tag ",
			"is a pointer its publisher can move. Pin the digest and keep the tag in a trailing comment: ",
			"`uses: docker://owner/image@sha256:<64 hex> # v1.2.3`.",
		]),
	}
}

pinned_as(ref) := "nothing" if ref.ref == ""

pinned_as(ref) := ref.ref if ref.ref != ""

# ---------------------------------------------------------------------------
# rule 7 — no container image on a floating tag
# ---------------------------------------------------------------------------

# `latest` and an absent tag are the same thing to Docker, and both mean "whatever
# upstream published last". Tags that float only inside a version line —
# `postgres:16-alpine`, `nginx:alpine` — are deliberately not reported: they are a
# considered choice here, and reporting them would make this list long enough to
# ignore.
floating_tags := {"latest", ""}

warn contains v if {
	some image in input.imageRefs
	floating_tags[image.tag]

	v := {
		"rule": "image_tag_is_pinned",
		"file": image.file,
		"line": image.line,
		"detail": floating_detail(image),
		"why": concat("", [
			"A floating tag means the image changes underneath a file nobody edited. The e2e suite is the ",
			"sharpest case: the stubs in infra/wiremock/mappings/ are written against one WireMock, so an ",
			"upstream release breaks a suite nobody changed, on a machine nobody touched. Pin a version. ",
			"Deny once #180 pins the three images that float.",
		]),
	}
}

# `${IMAGE_TAG:-latest}` is a different fault: the tag is operator-supplied and CI
# sets it on release, so what is wrong is only the default.
warn contains v if {
	some image in input.imageRefs
	image.interpolated
	contains(image.tag, "latest")

	v := {
		"rule": "image_tag_is_pinned",
		"file": image.file,
		"line": image.line,
		"detail": sprintf("`%s` falls back to `latest` when the variable is unset", [image.image]),
		"why": concat("", [
			"An operator who forgets to export IMAGE_TAG should get a refusal, not an arbitrary image. ",
			"Default it to a released version instead. Deny once #180 closes.",
		]),
	}
}

floating_detail(image) := sprintf("`%s` carries no tag, which Docker resolves to `latest`", [image.name]) if {
	not image.fromChartAppVersion
	image.tag == ""
}

floating_detail(image) := sprintf("`%s` is on `latest`", [image.image]) if {
	not image.fromChartAppVersion
	image.tag == "latest"
}

# The Helm chart has no `image:` scalar to report. Its tag is empty in values.yaml
# and `_helpers.tpl` resolves that to `Chart.appVersion`, so the message has to
# name all three or nobody can find what to edit.
floating_detail(image) := sprintf(
	"`%s` has an empty `tag`, so _helpers.tpl falls back to Chart.appVersion, which is `%s`",
	[image.name, image.tag],
) if {
	image.fromChartAppVersion
}
