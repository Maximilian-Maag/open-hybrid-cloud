import { listFiles, getFileContent, type CiSourceInfo } from '@/lib/ci'
import { parseTerraformVariables, parseTerraformModules } from '@/lib/tfparser'
import { parameters, type Parameter } from '@/lib/db/schema'
import { db } from '@/lib/db/client'
import { and, eq } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { isReservedCiVariable } from '@/lib/ci/reserved'

type ParsedParameter = Omit<Parameter, 'id' | 'scope' | 'scopeId' | 'environmentId'>

/** A variable the scan found, and where it came from. */
export interface ScannedVariable extends ParsedParameter {
  /**
   * Empty for the root template, otherwise the module path that declared it —
   * `network`, or `network/subnet` two levels down.
   *
   * Kept because "why is this parameter here" is the first question about an
   * imported list, and the answer is not in the variable's own name.
   */
  fromModule: string
}

/** A module the scan could see but not read. */
export interface SkippedModule {
  module: string
  source: string
  reason: string
}

export interface TemplateScan {
  variables: ScannedVariable[]
  skippedModules: SkippedModule[]
  /** Every .tf file actually read, root first. Shown so the operator can tell whether the path was right. */
  filesRead: string[]
}

/**
 * How deep the scan follows local `module` sources.
 *
 * Three is past anything this platform's templates do and short enough that a
 * pathological repository cannot turn one button press into hundreds of API
 * calls. A cycle is impossible to reach through relative paths without also
 * exceeding this.
 */
export const MAX_MODULE_DEPTH = 3

/** A source the CI file API can fetch: a path inside this repository. */
const isLocalSource = (source: string): boolean => source.startsWith('./') || source.startsWith('../')

/**
 * Resolve a module's relative source against the directory that calls it.
 *
 * Own implementation rather than `path.posix`: the inputs are repository paths,
 * never filesystem paths, and running them through the platform's resolver on
 * Windows would introduce backslashes the CI APIs do not accept.
 */
export const resolveRepoPath = (from: string, relative: string): string => {
  const segments = from.split('/').filter(Boolean)
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}

/**
 * Every Terraform variable a template still needs a value for, including the
 * ones declared by the modules it composes.
 *
 * A template built out of modules declares few variables of its own: the root
 * wires the modules together, and the values a person has to choose live in the
 * children. Reading only the root's `variables.tf` — which is all the previous
 * import did — therefore found nothing, and the button looked broken on exactly
 * the templates it was most needed for.
 *
 * A child variable is included only when the caller has NOT already assigned it.
 * `module "compute" { instance_type = var.instance_type }` means the root has
 * answered that one, and offering it to the ordering user a second time would
 * ask them to fill a value the template ignores.
 *
 * Remote sources — the registry, `git::`, anything not a relative path — cannot
 * be read through the CI file API. They are reported in `skippedModules` rather
 * than passed over silently: a partial import that says it is partial is usable,
 * one that does not is a trap.
 */
export const scanTemplate = async (
  source: CiSourceInfo,
  projectId: string,
  ref: string,
  path: string,
  depth = 0,
  seen: Set<string> = new Set(),
): Promise<TemplateScan> => {
  const scan: TemplateScan = { variables: [], skippedModules: [], filesRead: [] }

  // Two directories can reach the same module by different relative routes, and
  // a diamond would otherwise be read — and reported — twice.
  const key = path || '.'
  if (seen.has(key)) return scan
  seen.add(key)

  const entries = await listFiles(source, projectId, ref, path)
  const tfFiles = entries
    .filter((e) => e.type === 'blob' && e.name.endsWith('.tf'))
    .map((e) => e.path)
    .sort()

  let combined = ''
  for (const file of tfFiles) {
    // One unreadable file does not sink the import: a template directory holding
    // something the token cannot see is still worth the variables it can.
    try {
      combined += `${await getFileContent(source, projectId, ref, file)}\n`
      scan.filesRead.push(file)
    } catch {
      scan.skippedModules.push({ module: '', source: file, reason: 'could not be read from the CI source' })
    }
  }

  for (const variable of parseTerraformVariables(combined)) {
    scan.variables.push({ ...variable, fromModule: '' })
  }

  for (const call of parseTerraformModules(combined)) {
    if (!isLocalSource(call.source)) {
      scan.skippedModules.push({
        module: call.name,
        source: call.source,
        reason: 'not a path in this repository, so the file API cannot read it',
      })
      continue
    }
    if (depth >= MAX_MODULE_DEPTH) {
      scan.skippedModules.push({
        module: call.name,
        source: call.source,
        reason: `nested deeper than ${MAX_MODULE_DEPTH} levels`,
      })
      continue
    }

    const child = await scanTemplate(
      source,
      projectId,
      ref,
      resolveRepoPath(path, call.source),
      depth + 1,
      seen,
    )
    scan.filesRead.push(...child.filesRead)
    scan.skippedModules.push(...child.skippedModules)

    const answered = new Set(call.assigned)
    for (const variable of child.variables) {
      if (answered.has(variable.name)) continue
      scan.variables.push({
        ...variable,
        fromModule: variable.fromModule ? `${call.name}/${variable.fromModule}` : call.name,
      })
    }
  }

  // The root's own declaration wins over a module's, and an earlier module wins
  // over a later one — the first one read is the one nearest the template.
  const byName = new Map<string, ScannedVariable>()
  for (const variable of scan.variables) {
    if (!byName.has(variable.name)) byName.set(variable.name, variable)
  }
  scan.variables = [...byName.values()]

  return scan
}

/**
 * Variables the pipeline supplies to itself. Not things a person chooses, and a
 * parameter definition for one would be a field the run overwrites.
 */
const CI_INTERNAL_VARS = new Set(['ci_api_url', 'ci_project_id', 'ci_job_token', 'vm_state_name'])

/**
 * The variables from a scan that may become product parameters.
 *
 * Three exclusions, and the third is the one with teeth: a template declaring
 * `variable "ref"` or `variable "tf_action"` would otherwise produce a parameter
 * definition letting the ordering user choose the git ref, or turn a
 * provisioning order into a destroy (#183). The names the server owns are never
 * offered, whatever a template calls them.
 */
export const importableVariables = (scan: TemplateScan): ScannedVariable[] =>
  scan.variables.filter(
    (v) => !v.sensitive && !CI_INTERNAL_VARS.has(v.name) && !isReservedCiVariable(v.name),
  )

export interface ImportOutcome {
  created: number
  /** Already defined on this product, left as they are. */
  skipped: number
  createdNames: string[]
  skippedModules: SkippedModule[]
  filesRead: string[]
}

/**
 * Create a product parameter for every importable variable the product does not
 * already define.
 *
 * Existing definitions are never overwritten. An admin who has edited a label,
 * narrowed a type or set a different default has made a decision, and a
 * re-import is a request to pick up what is NEW — not to undo that.
 */
export const importScannedParameters = async (
  productId: number,
  scan: TemplateScan,
  actorId: number,
): Promise<ImportOutcome> => {
  const importable = importableVariables(scan)

  const existing = await db
    .select({ name: parameters.name })
    .from(parameters)
    .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, productId)))
  const existingNames = new Set(existing.map((p) => p.name))

  const fresh = importable.filter((v) => !existingNames.has(v.name))

  for (const v of fresh) {
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: productId,
      name: v.name,
      label: v.label,
      type: v.type,
      description: v.description,
      defaultValue: v.defaultValue,
      required: v.required,
      sensitive: false,
    })
  }

  // This path inserts `parameters` rows directly rather than going through
  // createParameter, so the service-layer audit sweep (#137) does not cover it.
  // Names only, never values — a synced default can be a connection string.
  if (fresh.length > 0) {
    await logAudit(
      actorId,
      'product.parameters_synced',
      productId,
      `Imported ${fresh.length} parameter(s) from the template: ${fresh.map((v) => v.name).join(', ')}`,
    )
  }

  return {
    created: fresh.length,
    skipped: importable.length - fresh.length,
    createdNames: fresh.map((v) => v.name),
    skippedModules: scan.skippedModules,
    filesRead: scan.filesRead,
  }
}
