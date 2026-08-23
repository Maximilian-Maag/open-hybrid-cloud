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
 */
const SECRET_SQL_COLUMNS = [
  'access_token',
  'webhook_token',
  'callback_secret',
  'password_hash',
  'smtp_pass',
  'ai_api_key',
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
  safeIdParses: number
  /** `parseInt`/`Number` applied to a value destructured from `params`. */
  unsafeIdParses: { line: number; call: string; segment: string }[]
  testFiles: string[]
}

/**
 * Identifiers bound from the route's `params`, e.g. `const { id, envId } = await params`.
 *
 * Narrowing rule 5 to these is what keeps it off the two `parseInt(searchParams…)`
 * call sites, which are query parameters and a different question entirely.
 */
function paramBindings(sf: ts.SourceFile): Set<string> {
  const bound = new Set<string>()
  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return
    if (!ts.isObjectBindingPattern(node.name)) return
    const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer
    const text = init.getText(sf)
    if (!/(^|\.)params$/.test(text)) return
    for (const element of node.name.elements) {
      if (ts.isIdentifier(element.name)) bound.add(element.name.text)
    }
  })
  return bound
}

function routeFacts(testImports: Map<string, string[]>): RouteFact[] {
  const files = walk(API_DIR, (rel) => rel.endsWith('/route.ts'))
  return files.map((file) => {
    const sf = parse(file)
    const params = paramBindings(sf)
    const methods: string[] = []
    const authHelpers = new Set<string>()
    const unsafeIdParses: RouteFact['unsafeIdParses'] = []
    let safeIdParses = 0

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
      if (!ts.isCallExpression(node)) return

      const callee = calleeName(node)
      if (callee && AUTH_HELPERS.has(callee)) authHelpers.add(callee)
      if (callee === 'parseRouteId') safeIdParses++

      if (callee === 'parseInt' || callee === 'Number') {
        const arg = node.arguments[0]
        if (arg && ts.isIdentifier(arg) && params.has(arg.text)) {
          unsafeIdParses.push({ line: lineOf(sf, node), call: node.getText(sf), segment: arg.text })
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
      safeIdParses,
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
        // first argument of whichever column builder was used.
        const m = /^\w+\(\s*'([^']+)'/.exec(p.initializer.getText(sf))
        if (m && SECRET_SQL_COLUMNS.includes(m[1])) secretColumns.push({ property, column: m[1] })
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
  languages: { code: string; keyCount: number; missing: string[] }[]
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

  return { file: I18N_FILE, interfaceKeys, languages }
}

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------

interface MigrationFacts {
  dir: string
  journalFile: string
  files: { file: string; tag: string; index: number }[]
  journal: { idx: number; tag: string }[]
}

function migrationFacts(): MigrationFacts {
  const journalFile = `${DRIZZLE_DIR}/meta/_journal.json`
  const files = walk(DRIZZLE_DIR, (rel) => rel.endsWith('.sql') && !rel.includes('/meta/'))
    .map((file) => {
      const tag = path.basename(file, '.sql')
      return { file, tag, index: Number.parseInt(tag.slice(0, 4), 10) }
    })
  const journal = exists(journalFile)
    ? (JSON.parse(read(journalFile)) as { entries: { idx: number; tag: string }[] }).entries.map(
        (e) => ({ idx: e.idx, tag: e.tag }),
      )
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
  local: boolean
}

function actionRefs(): ActionRef[] {
  const files = [
    ...walk('.github/workflows', (rel) => /\.ya?ml$/.test(rel)),
    ...walk('.github/actions', (rel) => /\/action\.ya?ml$/.test(rel)),
  ]
  return files.flatMap((file) =>
    scalarLines(file, 'uses').map(({ line, value }) => {
      const at = value.lastIndexOf('@')
      return {
        file,
        line,
        uses: value,
        action: at === -1 ? value : value.slice(0, at),
        ref: at === -1 ? '' : value.slice(at + 1),
        // A composite action in this repository is reviewed with the repository;
        // there is no third party to pin.
        local: value.startsWith('./') || value.startsWith('docker://'),
      }
    }),
  )
}

interface ImageRef extends Located {
  image: string
  name: string
  tag: string
  /** The tag comes from a shell expansion, e.g. `${IMAGE_TAG:-latest}`. */
  interpolated: boolean
}

function imageRefs(): ImageRef[] {
  const files = walk('infra', (rel) => /\.ya?ml$/.test(rel) && !rel.includes('/templates/'))
  const out: ImageRef[] = []
  for (const file of files) {
    for (const { line, value } of scalarLines(file, 'image')) {
      // `${IMAGE_TAG:-latest}` contains a colon that is not the tag separator, so
      // the split runs over a copy with every expansion blanked out.
      const masked = value.replace(/\$\{[^}]*\}/g, (m) => ' '.repeat(m.length))
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
  /** Whether any argument carries a value, rather than only fixed text. */
  namesAValue: boolean
}

/**
 * `console.*` in library code, and whether the line carries an identifier.
 *
 * #116 is about finding the log line for one order. A message that interpolates
 * nothing can be grepped for, but never narrowed — which is the difference this
 * records.
 */
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
      const args = node.arguments
      const namesAValue = args.some(
        (a) =>
          (ts.isTemplateExpression(a) && a.templateSpans.length > 0) ||
          (!ts.isStringLiteral(a) && !ts.isNoSubstitutionTemplateLiteral(a)),
      )
      const first = args[0]
      out.push({
        file,
        line: lineOf(sf, node),
        method: e.name.text,
        message: first ? first.getText(sf).split('\n')[0].slice(0, 120) : '',
        namesAValue,
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
