/**
 * Extracts the facts the Rego policies in `policy/` reason about.
 *
 * Rego cannot read TypeScript, and the invariants worth enforcing here are all
 * cross-file: a route and its test, a table and the test setup that truncates
 * it, a translation key and 25 tables. So this walks the tree once and emits a
 * single JSON document — the whole input to `opa eval`.
 *
 * Two deliberate choices:
 *
 *  - TypeScript is read through the compiler's own parser (`createSourceFile`,
 *    no type checker) rather than by regex. Parsing costs ~1 s for the whole
 *    repo and removes the class of policy bug where a rule fires on a string
 *    literal or a comment.
 *
 *  - YAML is read line by line rather than through a YAML library. The facts we
 *    need from it are single scalars (`uses:`, `image:`) and every violation
 *    message has to say *which line* to edit; a parsed document throws the line
 *    numbers away, and adding a YAML dependency re-resolved unrelated entries in
 *    the lockfile. The subset scanned here — a scalar after a key on its own
 *    line — is the only shape these files use.
 *
 * Usage: `tsx scripts/policy-facts.ts [--out facts.json]` (default: stdout).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const BACKEND = 'apps/backend'
const FRONTEND = 'apps/frontend'
const API_DIR = `${BACKEND}/src/app/api`
const SCHEMA_FILE = `${BACKEND}/src/lib/db/schema.ts`
const TEST_SETUP_FILE = `${BACKEND}/src/test/setup.ts`
const DRIZZLE_DIR = `${BACKEND}/drizzle`
const I18N_FILE = `${FRONTEND}/src/lib/i18n.ts`

/**
 * Columns that hold a credential. Named by their SQL identifier because that is
 * what a reviewer greps for and what the migration says; the extractor maps them
 * back to the Drizzle property names, so a policy can name both.
 *
 * The list is every column `schema.ts` documents as secret-bearing, not the ones
 * #144 happened to leak. A column that is absent here produces no fact at all, so
 * a projection that reaches it is neither denied nor deliberately allowlisted —
 * it is simply invisible, which is the failure mode this rule exists to remove.
 */
const SECRET_SQL_COLUMNS = [
  'access_token',
  'webhook_token',
  'callback_secret',
  'password_hash',
  'smtp_pass',
  'ai_api_key',
  // The session token's SHA-256 (sessions). Not the token itself, but a dump of
  // these is enough to recognise a presented token, so it stays off responses.
  'token_hash',
  // The TOTP factor (user_totp): an AES-256-GCM envelope of the shared secret,
  // and the in-flight enrollment kept beside it.
  'secret',
  'pending_secret',
  // SHA-256 of a recovery code (user_recovery_codes).
  'code_hash',
  // The integration registry's encrypted token or password (integrations).
  'credential',
]

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const AUTH_HELPERS = new Set(['requireAuth', 'requireRole', 'requireRoot'])

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', 'dist', '.stryker-tmp', 'test-results'])

function walk(dir: string, keep: (rel: string) => boolean): string[] {
  const abs = path.join(REPO_ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(rel, keep))
    else if (keep(rel)) out.push(rel)
  }
  return out.sort()
}

const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO_ROOT, rel))

const parse = (rel: string): ts.SourceFile =>
  ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, /* setParentNodes */ true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  ts.forEachChild(node, (child) => visit(child, fn))
}

/** The name being called, for `f()`, `o.f()` and `o.p.f()` alike. */
function calleeName(node: ts.CallExpression): string | null {
  const e = node.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text
  return null
}

const propName = (p: ts.ObjectLiteralElementLike): string | null =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

interface RouteFact {
  file: string
  apiPath: string
  methods: string[]
  authHelpers: string[]
  dynamicSegments: string[]
  lines: number
  /** The `params` keys that reach `parseRouteId`, not how many times it was called. */
  safeIdSegments: string[]
  /** `parseRouteId(x)` where `x` could not be traced back to a `params` key. */
  unattributedSafeIdParses: number
  /** `parseInt`/`Number` applied to a value destructured from `params`. */
  unsafeIdParses: { line: number; call: string; segment: string }[]
  testFiles: string[]
}

/**
 * Local name -> the `params` key it was destructured from.
 *
 * `const { id, envId } = await params` binds both under their own names;
 * `const { id: rawOrderId } = await params` binds `rawOrderId` to the key `id`.
 * The key is what the rule needs, because that is what the `[segment]` directory
 * is called — the local name is the route author's choice.
 *
 * Narrowing rule 5 to these is what keeps it off the two `parseInt(searchParams…)`
 * call sites, which are query parameters and a different question entirely.
 */
function paramBindings(sf: ts.SourceFile): Map<string, string> {
  const bound = new Map<string, string>()
  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return
    if (!ts.isObjectBindingPattern(node.name)) return
    const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer
    const text = init.getText(sf)
    if (!/(^|\.)params$/.test(text)) return
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue
      const key =
        element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName))
          ? element.propertyName.text
          : element.name.text
      bound.set(element.name.text, key)
    }
  })
  return bound
}

/**
 * The `params` key a `parseRouteId(...)` argument names, or null.
 *
 * Two shapes occur in this tree: an identifier destructured from `params`
 * (`parseRouteId(sourceId)`) and a direct read (`parseRouteId((await params).itemId)`).
 * Anything else — a value threaded through a helper, a computed key — is
 * deliberately *not* guessed at; it is counted separately so the rule can say it
 * saw a parse it could not attribute rather than silently crediting a segment.
 */
function parsedSegment(arg: ts.Expression, params: Map<string, string>): string | null {
  if (ts.isIdentifier(arg)) return params.get(arg.text) ?? null
  if (ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.name)) {
    const base = arg.expression
    const inner = ts.isAwaitExpression(base) ? base.expression : base
    if (ts.isParenthesizedExpression(inner)) {
      const unwrapped = ts.isAwaitExpression(inner.expression) ? inner.expression.expression : inner.expression
      if (/(^|\.)params$/.test(unwrapped.getText())) return arg.name.text
    }
    if (/(^|\.)params$/.test(inner.getText())) return arg.name.text
  }
  return null
}

function routeFacts(testImports: Map<string, string[]>): RouteFact[] {
  const files = walk(API_DIR, (rel) => rel.endsWith('/route.ts'))
  return files.map((file) => {
    const sf = parse(file)
    const params = paramBindings(sf)
    const methods: string[] = []
    const authHelpers = new Set<string>()
    const unsafeIdParses: RouteFact['unsafeIdParses'] = []
    const safeIdSegments = new Set<string>()
    let unattributedSafeIdParses = 0

    visit(sf, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && HTTP_METHODS.has(node.name.text)) {
        const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        if (exported) methods.push(node.name.text)
      }
      if (ts.isVariableStatement(node)) {
        const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        for (const d of node.declarationList.declarations) {
          if (exported && ts.isIdentifier(d.name) && HTTP_METHODS.has(d.name.text)) methods.push(d.name.text)
        }
      }
      // `const GET = handler; export { GET }` and `export { handler as GET }`
      // export exactly as much as `export const GET` does. Missing them would let
      // an endpoint leave rules 1 and 10 — both gated on `count(methods) > 0` —
      // by changing only the shape of its export.
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          if (HTTP_METHODS.has(element.name.text)) methods.push(element.name.text)
        }
      }
      if (!ts.isCallExpression(node)) return

      const callee = calleeName(node)
      if (callee && AUTH_HELPERS.has(callee)) authHelpers.add(callee)
      if (callee === 'parseRouteId') {
        const arg = node.arguments[0]
        const segment = arg ? parsedSegment(arg, params) : null
        if (segment === null) unattributedSafeIdParses++
        else safeIdSegments.add(segment)
      }

      if (callee === 'parseInt' || callee === 'Number') {
        const arg = node.arguments[0]
        if (arg && ts.isIdentifier(arg) && params.has(arg.text)) {
          unsafeIdParses.push({
            line: lineOf(sf, node),
            call: node.getText(sf),
            segment: params.get(arg.text) as string,
          })
        }
      }
    })

    const apiPath = file.slice(`${API_DIR}/`.length, -'/route.ts'.length)
    return {
      file,
      apiPath,
      methods: [...new Set(methods)].sort(),
      authHelpers: [...authHelpers].sort(),
      dynamicSegments: apiPath.split('/').filter((s) => s.startsWith('[')),
      lines: read(file).split('\n').length,
      safeIdSegments: [...safeIdSegments].sort(),
      unattributedSafeIdParses,
      unsafeIdParses,
      testFiles: testImports.get(file) ?? [],
    }
  })
}

/**
 * route.ts -> the route.test.ts files that import it.
 *
 * Not "is there a sibling route.test.ts": `sessions/route.test.ts` imports and
 * exercises `sessions/[id]/route.ts`, and a rule that only looked for siblings
 * would report a route that is in fact covered. Import edges are the honest
 * signal.
 */
function routeTestImports(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const testFile of walk(API_DIR, (rel) => rel.endsWith('.test.ts'))) {
    const sf = parse(testFile)
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const spec = stmt.moduleSpecifier.text
      const resolved = spec.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(testFile), spec))
        : spec.startsWith('@/')
          ? path.posix.join(`${BACKEND}/src`, spec.slice(2))
          : null
      if (!resolved) continue
      const target = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
      if (!target.endsWith('/route.ts')) continue
      map.set(target, [...(map.get(target) ?? []), testFile])
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// database schema vs. test setup
// ---------------------------------------------------------------------------

interface TableFact {
  export: string
  name: string
  secretColumns: { property: string; column: string }[]
  inTestDdl: boolean
  inTestTables: boolean
}

function tableFacts(): TableFact[] {
  const sf = parse(SCHEMA_FILE)
  const tables: TableFact[] = []

  const setup = read(TEST_SETUP_FILE)
  const ddlTables = new Set(
    [...setup.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/gi)].map((m) => m[1]),
  )
  const truncated = new Set(
    [...setup.matchAll(/^\s*schema\.(\w+),/gm)].map((m) => m[1]),
  )

  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return
    if (!ts.isCallExpression(node.initializer)) return
    if (calleeName(node.initializer) !== 'pgTable') return
    const [nameArg, columnsArg] = node.initializer.arguments
    if (!nameArg || !ts.isStringLiteral(nameArg) || !ts.isIdentifier(node.name)) return

    const secretColumns: TableFact['secretColumns'] = []
    if (columnsArg && ts.isObjectLiteralExpression(columnsArg)) {
      for (const p of columnsArg.properties) {
        const property = propName(p)
        if (!property || !ts.isPropertyAssignment(p)) continue
        // `text('access_token')`, `varchar('smtp_pass', …)` — the SQL name is the
        // first argument of whichever column builder was used. `credential: text()`
        // gives no name at all, and drizzle then uses the property verbatim (this
        // schema sets no `casing`), so that is the fallback rather than a skip:
        // without it the integration registry's credential column has no fact.
        const text = p.initializer.getText(sf)
        const named = /^\w+\(\s*'([^']+)'/.exec(text)
        const column = named ? named[1] : property
        if (SECRET_SQL_COLUMNS.includes(column)) secretColumns.push({ property, column })
      }
    }

    tables.push({
      export: node.name.text,
      name: nameArg.text,
      secretColumns,
      inTestDdl: ddlTables.has(nameArg.text),
      inTestTables: truncated.has(node.name.text),
    })
  })

  return tables.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// select() projections
// ---------------------------------------------------------------------------

interface SelectFact {
  file: string
  line: number
  /** Column properties named in the projection, as `table.column` where visible. */
  columns: string[]
  secretColumns: string[]
}

/**
 * Every `.select({ … })` whose projection names a secret column.
 *
 * A bare `.select()` is not reported: it is unavoidably a whole-row read and
 * flagging all ~40 of them would drown the signal. What #144 actually was — a
 * hand-written projection that reached one column too far — is exactly what a
 * named projection makes visible.
 */
function selectFacts(secretProperties: Set<string>): SelectFact[] {
  const sources = [
    ...walk(`${BACKEND}/src`, (rel) => rel.endsWith('.ts') && !rel.endsWith('.test.ts')),
    ...walk(`${FRONTEND}/src`, (rel) => (rel.endsWith('.ts') || rel.endsWith('.tsx')) && !/\.test\.tsx?$/.test(rel)),
  ]
  const out: SelectFact[] = []
  for (const file of sources) {
    if (!read(file).includes('.select(')) continue
    const sf = parse(file)
    visit(sf, (node) => {
      if (!ts.isCallExpression(node) || calleeName(node) !== 'select') return
      const [projection] = node.arguments
      if (!projection || !ts.isObjectLiteralExpression(projection)) return
      const columns: string[] = []
      const secrets: string[] = []
      for (const p of projection.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const key = propName(p)
        const value = p.initializer.getText(sf)
        if (key) columns.push(`${key}: ${value}`)
        const referenced = /\.(\w+)$/.exec(value)?.[1]
        if (referenced && secretProperties.has(referenced)) secrets.push(referenced)
      }
      if (secrets.length > 0) {
        out.push({ file, line: lineOf(sf, node), columns, secretColumns: [...new Set(secrets)] })
      }
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

interface I18nFacts {
  file: string
  interfaceKeys: string[]
  /** The codes in `SUPPORTED_LANGUAGES` — what the UI offers, table or no table. */
  supported: string[]
  languages: { code: string; keyCount: number; missing: string[] }[]
}

/**
 * The codes in `export const SUPPORTED_LANGUAGES = [{ code: 'bg', … }, …]`.
 *
 * Read separately from `translations` on purpose. A rule that only walked the
 * tables it found could never see the interesting failure — a code the language
 * picker still offers whose table was deleted, which `t()` answers entirely in
 * English without anything failing.
 */
function supportedCodes(sf: ts.SourceFile): string[] {
  const codes: string[] = []
  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return
    if (node.name.text !== 'SUPPORTED_LANGUAGES' || !node.initializer) return
    const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer
    if (!ts.isArrayLiteralExpression(init)) return
    for (const entry of init.elements) {
      if (!ts.isObjectLiteralExpression(entry)) continue
      for (const p of entry.properties) {
        if (!ts.isPropertyAssignment(p) || propName(p) !== 'code') continue
        if (ts.isStringLiteral(p.initializer)) codes.push(p.initializer.text)
      }
    }
  })
  return codes.sort()
}

function i18nFacts(): I18nFacts {
  const sf = parse(I18N_FILE)
  let interfaceKeys: string[] = []
  const languages: I18nFacts['languages'] = []

  visit(sf, (node) => {
    // `export type Translations = { … }`
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === 'Translations' &&
      ts.isTypeLiteralNode(node.type)
    ) {
      interfaceKeys = node.type.members
        .map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : null))
        .filter((n): n is string => n !== null)
    }
    // `interface Translations { … }`, should it ever be written that way
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Translations') {
      interfaceKeys = node.members
        .map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : null))
        .filter((n): n is string => n !== null)
    }
  })

  const known = new Set(interfaceKeys)
  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return
    if (node.name.text !== 'translations' || !node.initializer) return
    if (!ts.isObjectLiteralExpression(node.initializer)) return
    for (const lang of node.initializer.properties) {
      const code = propName(lang)
      if (!code || !ts.isPropertyAssignment(lang) || !ts.isObjectLiteralExpression(lang.initializer)) continue
      const keys = new Set(
        lang.initializer.properties
          .map((p) => propName(p))
          .filter((n): n is string => n !== null),
      )
      languages.push({
        code,
        keyCount: keys.size,
        missing: [...known].filter((k) => !keys.has(k)),
      })
    }
  })

  return { file: I18N_FILE, interfaceKeys, supported: supportedCodes(sf), languages }
}

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------

interface MigrationFacts {
  dir: string
  journalFile: string
  files: { file: string; tag: string; index: number }[]
  /**
   * The journal in file order. `when` is carried because it is the field
   * drizzle-kit actually compares — see the rule in policy/database.rego.
   */
  journal: { idx: number; tag: string; when: number }[]
}

function migrationFacts(): MigrationFacts {
  const journalFile = `${DRIZZLE_DIR}/meta/_journal.json`
  const files = walk(DRIZZLE_DIR, (rel) => rel.endsWith('.sql') && !rel.includes('/meta/'))
    .map((file) => {
      const tag = path.basename(file, '.sql')
      return { file, tag, index: Number.parseInt(tag.slice(0, 4), 10) }
    })
  const journal = exists(journalFile)
    ? (
        JSON.parse(read(journalFile)) as { entries: { idx: number; tag: string; when: number }[] }
      ).entries.map((e) => ({ idx: e.idx, tag: e.tag, when: e.when }))
    : []
  return { dir: DRIZZLE_DIR, journalFile, files, journal }
}

// ---------------------------------------------------------------------------
// YAML-sourced facts (see the note at the top of this file)
// ---------------------------------------------------------------------------

interface Located {
  file: string
  line: number
}

/** Every `key: value` pair on its own line, with the line number kept. */
function scalarLines(file: string, key: string): (Located & { value: string })[] {
  const out: (Located & { value: string })[] = []
  read(file).split('\n').forEach((raw, i) => {
    const m = new RegExp(`^\\s*-?\\s*${key}:\\s*(.+?)\\s*(?:#.*)?$`).exec(raw)
    if (!m) return
    const value = m[1].replace(/^["']|["']$/g, '')
    if (value === '' || value === '|' || value === '>') return
    out.push({ file, line: i + 1, value })
  })
  return out
}

interface ActionRef extends Located {
  uses: string
  action: string
  ref: string
  /**
   * What has to be pinned, and to what:
   *
   *  - `local`   — `./.github/actions/…`, reviewed with this repository.
   *  - `docker`  — `docker://…`, a third-party *image*, pinned by digest.
   *  - `repo`    — `owner/action@…`, a third-party repository, pinned by commit.
   *
   * `docker://` used to be filed under `local`, which read as "not ours to pin"
   * and is the opposite of the truth: it is the one form that fetches a whole
   * root filesystem from a registry, and `docker://vendor/image:latest` was
   * exempt from rule 6 entirely.
   */
  kind: 'local' | 'docker' | 'repo'
}

function actionRefs(): ActionRef[] {
  const files = [
    ...walk('.github/workflows', (rel) => /\.ya?ml$/.test(rel)),
    ...walk('.github/actions', (rel) => /\/action\.ya?ml$/.test(rel)),
  ]
  return files.flatMap((file) =>
    scalarLines(file, 'uses').map(({ line, value }) => {
      // A digest is `image@sha256:…`, a commit is `action@<sha>`; both sit after
      // the last `@`, and `docker://` carries no `@` of its own.
      const at = value.lastIndexOf('@')
      const kind = value.startsWith('./') ? 'local' : value.startsWith('docker://') ? 'docker' : 'repo'
      return {
        file,
        line,
        uses: value,
        action: at === -1 ? value : value.slice(0, at),
        ref: at === -1 ? '' : value.slice(at + 1),
        kind,
      } satisfies ActionRef
    }),
  )
}

interface ImageRef extends Located {
  image: string
  name: string
  tag: string
  /** The tag comes from a shell expansion, e.g. `${IMAGE_TAG:-latest}`. */
  interpolated: boolean
  /**
   * Where the reference was assembled. `helm` means it does not appear as an
   * `image:` scalar anywhere — the chart splits it across `repository`, `tag` and
   * `Chart.appVersion` — so the rule's message has to say which of those to edit.
   */
  origin: 'compose' | 'helm'
  /** Helm only: the chart's `tag` is empty, so the tag is `Chart.appVersion`. */
  fromChartAppVersion: boolean
}

/**
 * The image a Helm chart actually deploys.
 *
 * There is no `image:` scalar to read. `values.yaml` holds `repository` and
 * `tag` under an `image:` mapping, the deployment templates call
 * `open-hybrid-cloud.<component>.image`, and `_helpers.tpl` resolves the pair as
 * `.Values.<component>.image.tag | default .Chart.AppVersion`. So an empty `tag`
 * — which is what the chart ships — silently means `Chart.appVersion`, and that
 * is `latest`. Walking `image:` scalars alone saw none of this and reported the
 * chart as clean.
 *
 * Reported against values.yaml rather than the template, because the tag is what
 * an operator edits and the fallback is what makes the empty value dangerous.
 */
function helmImageRefs(): ImageRef[] {
  const out: ImageRef[] = []
  for (const chart of walk('infra', (rel) => /\/Chart\.ya?ml$/.test(rel))) {
    const dir = path.posix.dirname(chart)
    const valuesFile = `${dir}/values.yaml`
    if (!exists(valuesFile)) continue
    const appVersion = scalarLines(chart, 'appVersion')[0]?.value ?? ''

    // `image:` opens a mapping; `repository` and `tag` are the lines under it
    // that are indented further. Same line-oriented subset as the rest of this
    // file — the point is to keep the line number the message has to print.
    const lines = read(valuesFile).split('\n')
    lines.forEach((raw, i) => {
      const opening = /^(\s*)image:\s*(?:#.*)?$/.exec(raw)
      if (!opening) return
      const indent = opening[1].length
      let repository = ''
      let tag: string | null = null
      let tagLine = i + 1
      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j]
        if (body.trim() === '' || /^\s*#/.test(body)) continue
        const width = body.length - body.trimStart().length
        if (width <= indent) break
        const m = /^\s*(\w+):\s*(.*?)\s*(?:#.*)?$/.exec(body)
        if (!m) continue
        const value = m[2].replace(/^["']|["']$/g, '')
        if (m[1] === 'repository') repository = value
        if (m[1] === 'tag') {
          tag = value
          tagLine = j + 1
        }
      }
      if (repository === '') return
      const fromChartAppVersion = tag === null || tag === ''
      const effective = fromChartAppVersion ? appVersion : (tag as string)
      out.push({
        file: valuesFile,
        line: tagLine,
        image: `${repository}:${effective}`,
        name: repository,
        tag: effective,
        interpolated: effective.includes('${'),
        origin: 'helm',
        fromChartAppVersion,
      })
    })
  }
  return out
}

function imageRefs(): ImageRef[] {
  const files = walk('infra', (rel) => /\.ya?ml$/.test(rel) && !rel.includes('/templates/'))
  const out: ImageRef[] = [...helmImageRefs()]
  for (const file of files) {
    for (const { line, value } of scalarLines(file, 'image')) {
      // `${IMAGE_TAG:-latest}` contains a colon that is not the tag separator, so
      // the split runs over a copy with every expansion blanked out. The filler is
      // written as an escape and not as a literal NUL: a raw NUL byte in the source
      // makes git, grep and ripgrep classify this file as binary and stop showing
      // its diffs.
      const masked = value.replace(/\$\{[^}]*\}/g, (m) => '\0'.repeat(m.length))
      const colon = masked.lastIndexOf(':')
      const hasTag = colon > masked.lastIndexOf('/')
      const tag = hasTag ? value.slice(colon + 1) : ''
      out.push({
        file,
        line,
        image: value,
        name: hasTag ? value.slice(0, colon) : value,
        tag,
        interpolated: tag.includes('${'),
        origin: 'compose',
        fromChartAppVersion: false,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// hygiene: silenced failures and log call sites
// ---------------------------------------------------------------------------

interface SilentCatch extends Located {
  kind: string
  documented: boolean
}

/**
 * `catch {}` and `.catch(() => {})`, and whether the reason is inside the braces.
 *
 * "Documented" means a comment in the empty block itself — `catch { /* use
 * defaults *\/ }` — and nothing else. That is not a guess about style: 21 of the
 * 23 silent catches in the tree already write it that way, and it is the only
 * placement that stays attached when the code around it moves. A comment further
 * up describes the statement it sits above, which may or may not be the reason
 * this particular failure is safe to drop.
 *
 * A block holding only a comment has no statements, so these are still counted
 * as silenced — the rule is about explanation, not about whether the block is
 * literally empty.
 */
function silentCatches(): SilentCatch[] {
  const sources = [
    ...walk(`${BACKEND}/src`, (rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)),
    ...walk(`${FRONTEND}/src`, (rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)),
  ]
  const out: SilentCatch[] = []

  for (const file of sources) {
    if (!read(file).includes('catch')) continue
    const sf = parse(file)
    const explained = (block: ts.Block): boolean => /\/\/|\/\*/.test(block.getText(sf))

    visit(sf, (node) => {
      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        out.push({
          file,
          line: lineOf(sf, node),
          kind: 'catch {}',
          documented: explained(node.block),
        })
        return
      }
      if (!ts.isCallExpression(node) || calleeName(node) !== 'catch') return
      const [handler] = node.arguments
      if (!handler || !ts.isArrowFunction(handler)) return
      if (!ts.isBlock(handler.body) || handler.body.statements.length > 0) return
      out.push({
        file,
        line: lineOf(sf, node),
        kind: '.catch(() => {})',
        documented: explained(handler.body),
      })
    })
  }
  return out
}

interface ConsoleCall extends Located {
  method: string
  message: string
  /** Whether the *message* interpolates a value, rather than being fixed text. */
  messageNamesAValue: boolean
}

/**
 * `console.*` in library code, and whether its message carries a value.
 *
 * #116 is about finding the log line for one order. A message that interpolates
 * nothing can be grepped for, but never narrowed — which is the difference this
 * records.
 *
 * Only the message argument counts, and only when it interpolates. Counting *any*
 * non-literal argument made the fact true for every `console.error('… failed:', err)`
 * in the tree — an Error is not a record id, and it is exactly the argument that
 * is always there — so the rule reported nothing it was written to report.
 */
const messageNamesAValue = (arg: ts.Expression | undefined): boolean => {
  if (arg === undefined) return false
  if (ts.isTemplateExpression(arg)) return arg.templateSpans.length > 0
  // Six messages in this tree are long enough to be split across `+`, and the
  // interpolation is usually in the first fragment; treating the concatenation as
  // opaque would report every one of them.
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return messageNamesAValue(arg.left) || messageNamesAValue(arg.right)
  }
  if (ts.isParenthesizedExpression(arg)) return messageNamesAValue(arg.expression)
  return false
}

function consoleCalls(): ConsoleCall[] {
  const sources = [
    ...walk(`${BACKEND}/src/lib`, (rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)),
    ...walk(`${FRONTEND}/src/lib`, (rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)),
  ]
  const out: ConsoleCall[] = []
  for (const file of sources) {
    if (!read(file).includes('console.')) continue
    const sf = parse(file)
    visit(sf, (node) => {
      if (!ts.isCallExpression(node)) return
      const e = node.expression
      if (!ts.isPropertyAccessExpression(e) || e.expression.getText(sf) !== 'console') return
      const first = node.arguments[0]
      out.push({
        file,
        line: lineOf(sf, node),
        method: e.name.text,
        message: first ? first.getText(sf).split('\n')[0].slice(0, 120) : '',
        messageNamesAValue: messageNamesAValue(first),
      })
    })
  }
  return out
}

// ---------------------------------------------------------------------------

export function collectFacts(): Record<string, unknown> {
  const testImports = routeTestImports()
  const tables = tableFacts()
  const secretProperties = new Set(tables.flatMap((t) => t.secretColumns.map((c) => c.property)))

  return {
    repo: path.basename(REPO_ROOT),
    routes: routeFacts(testImports),
    tables,
    testSetupFile: TEST_SETUP_FILE,
    schemaFile: SCHEMA_FILE,
    secretColumns: SECRET_SQL_COLUMNS,
    selects: selectFacts(secretProperties),
    i18n: i18nFacts(),
    migrations: migrationFacts(),
    actionRefs: actionRefs(),
    imageRefs: imageRefs(),
    silentCatches: silentCatches(),
    consoleCalls: consoleCalls(),
  }
}

// Run as a script it prints the bundle; imported by scripts/policy-check.ts it
// only exports collectFacts().
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const json = `${JSON.stringify(collectFacts(), null, 2)}\n`
  const outFlag = process.argv.indexOf('--out')
  if (outFlag !== -1 && process.argv[outFlag + 1]) fs.writeFileSync(process.argv[outFlag + 1], json)
  else process.stdout.write(json)
}
