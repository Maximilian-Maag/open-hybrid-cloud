/**
 * `make policy`: run the Rego bundle in `policy/` against the current tree.
 *
 * The same three steps CI runs, in the same order, so a green run here means a
 * green check there:
 *
 *   1. `opa test policy` — a policy with a bug is worse than no policy, so the
 *      gate refuses to render a verdict from rules that do not pass their own
 *      tests.
 *   2. `scripts/policy-facts.ts` — the source tree as one JSON document.
 *   3. `opa eval` — deny fails the build, warn is reported and does not.
 *
 * The report is formatted here rather than in Rego because every violation has
 * to print three things — the rule, the file, and why the rule exists — and
 * `opa eval --format pretty` renders a multi-line string with the newlines
 * escaped, which is exactly the output nobody reads.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { collectFacts } from './policy-facts.ts'
import { OPA_VERSION, resolveOpa } from './opa.ts'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

interface Violation {
  rule: string
  file: string
  line: number
  detail: string
  why: string
}

/** Wrap `text` to `width`, indenting continuation lines by `indent`. */
function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/)) {
    if (current === '') current = word
    else if (current.length + 1 + word.length <= width) current += ` ${word}`
    else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n')
}

function render(level: 'DENY' | 'WARN', v: Violation): string {
  const where = v.line > 0 ? `${v.file}:${v.line}` : v.file
  return [
    `${level}  ${v.rule}  ${where}`,
    `      ${wrap(v.detail, 92, '      ')}`,
    `      why: ${wrap(v.why, 87, '           ')}`,
    '',
  ].join('\n')
}

function run(bin: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function main(): void {
  const opa = resolveOpa()
  if (!opa) {
    process.stderr.write(
      `No opa ${OPA_VERSION} matching the pinned checksum was found.\n` +
        `Run \`make policy-install-opa\` to fetch it into .opa/.\n` +
        `An opa on PATH or named by OPA= is used only if its SHA-256 is the pinned one — ` +
        `a distribution build of ${OPA_VERSION} is a different artefact and is not accepted, ` +
        `because a version string is not identity (see scripts/opa.ts).\n`,
    )
    process.exit(2)
  }

  const unit = run(opa, ['test', 'policy', '--format', 'pretty'])
  if (unit.status !== 0) {
    process.stderr.write(`${unit.stdout}${unit.stderr}\nThe policies do not pass their own tests.\n`)
    process.exit(1)
  }

  const factsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-policy-')), 'facts.json')
  fs.writeFileSync(factsFile, `${JSON.stringify(collectFacts(), null, 2)}\n`)

  const evaluated = run(opa, [
    'eval',
    '--fail', // an undefined result is a broken bundle, not a pass
    '-d',
    'policy',
    '-i',
    factsFile,
    '--format',
    'json',
    'data.repo.policy.report',
  ])
  if (evaluated.status !== 0) {
    process.stderr.write(`${evaluated.stdout}${evaluated.stderr}`)
    process.exit(1)
  }

  const report = JSON.parse(evaluated.stdout).result[0].expressions[0].value as {
    deny: Violation[]
    warn: Violation[]
  }
  const byRule = (a: Violation, b: Violation) =>
    a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line

  const out: string[] = ['']
  for (const v of [...report.deny].sort(byRule)) out.push(render('DENY', v))
  for (const v of [...report.warn].sort(byRule)) out.push(render('WARN', v))

  const rules = new Set([...report.deny, ...report.warn].map((v) => v.rule))
  out.push(
    `${report.deny.length} deny, ${report.warn.length} warn` +
      (rules.size > 0 ? ` across ${rules.size} rule${rules.size === 1 ? '' : 's'}` : '') +
      ` (opa ${OPA_VERSION}, facts: ${factsFile})`,
  )
  if (report.deny.length === 0) out.push('Policy gate passed. Warnings do not fail the build.')

  process.stdout.write(`${out.join('\n')}\n`)
  process.exit(report.deny.length > 0 ? 1 : 0)
}

main()
