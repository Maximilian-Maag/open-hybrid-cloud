package repo.policy_test

import data.repo.policy

# The runner reads `report` and nothing else, so it has to be defined even when
# the tree is clean — an undefined result there would look like a broken bundle.
test_report_is_defined_for_an_empty_tree if {
	report := policy.report with input as {}
	report.deny == []
	report.warn == []
}

# Every violation, from every rule, carries the four fields the runner prints.
# This is the check that stops a new rule from shipping a message nobody can act
# on, and it runs against the real tree rather than a fixture.
test_every_violation_has_a_rule_a_file_and_a_reason if {
	facts := {
		"routes": [{
			"file": "apps/backend/src/app/api/x/route.ts",
			"apiPath": "x",
			"methods": ["GET"],
			"authHelpers": [],
			"dynamicSegments": ["[id]"],
			"lines": 500,
			"safeIdParses": 0,
			"unsafeIdParses": [{"line": 9, "call": "parseInt(id)", "segment": "id"}],
			"testFiles": [],
		}],
		"selects": [{
			"file": "apps/backend/src/lib/services/x.ts",
			"line": 3,
			"columns": [],
			"secretColumns": ["accessToken"],
		}],
		"tables": [{"export": "x", "name": "x", "secretColumns": [], "inTestDdl": false, "inTestTables": false}],
		"testSetupFile": "apps/backend/src/test/setup.ts",
		"schemaFile": "apps/backend/src/lib/db/schema.ts",
		"i18n": {
			"file": "apps/frontend/src/lib/i18n.ts",
			"interfaceKeys": ["a"],
			"languages": [{"code": "el", "keyCount": 0, "missing": ["a"]}],
		},
		"migrations": {
			"dir": "apps/backend/drizzle",
			"journalFile": "apps/backend/drizzle/meta/_journal.json",
			"files": [{"file": "apps/backend/drizzle/0000_a.sql", "tag": "0000_a", "index": 0}],
			"journal": [{"idx": 2, "tag": "0002_b"}],
		},
		"actionRefs": [{"file": ".github/workflows/ci.yml", "line": 1, "uses": "a@v1", "action": "a", "ref": "v1", "local": false}],
		"imageRefs": [{"file": "infra/docker-compose.dev.yml", "line": 1, "image": "a:latest", "name": "a", "tag": "latest", "interpolated": false}],
		"silentCatches": [{"file": "apps/backend/src/lib/x.ts", "line": 1, "kind": "catch {}", "documented": false}],
		"consoleCalls": [{"file": "apps/backend/src/lib/services/x.ts", "line": 1, "method": "warn", "message": "'x'", "namesAValue": false}],
	}
	report := policy.report with input as facts

	# Every rule in the catalogue fired at least once, so the assertion below is
	# checking all of them rather than whichever two happened to be reachable.
	# Thirteen names for the twelve rules #149 lists, because rule 4 reports a
	# journal that disagrees with the directory separately from a gap in the
	# numbering: one is a broken deployment, the other is history.
	count({v.rule | some v in array.concat(report.deny, report.warn)}) == 13

	every v in array.concat(report.deny, report.warn) {
		v.rule != ""
		v.file != ""
		count(v.detail) > 10
		count(v.why) > 40
	}
}
