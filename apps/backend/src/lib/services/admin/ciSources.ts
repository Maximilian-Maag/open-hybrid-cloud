import { db } from '@/lib/db/client'
import { ciSources, deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listProjects, listBranches, listFiles, getFileContent } from '@/lib/ci'
import { parseTerraformVariables } from '@/lib/tfparser'
import { ok, err, type Result } from '@/lib/services/result'
import { logAudit, logAuditWith, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'
import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

export interface CiSourcePublic {
  id: number
  name: string
  url: string
  provider: string
}

export interface CreateCiSourceInput {
  name: string
  url: string
  accessToken: string
  provider: 'gitlab' | 'github' | 'bitbucket'
}

export interface UpdateCiSourceInput {
  name?: string
  url?: string
  accessToken?: string
  provider?: 'gitlab' | 'github' | 'bitbucket'
}

const safeColumns = {
  id: ciSources.id,
  name: ciSources.name,
  url: ciSources.url,
  provider: ciSources.provider,
}

const getSourceOrErr = async (id: number) => {
  const rows = await db
    .select()
    .from(ciSources)
    .where(eq(ciSources.id, id))
    .limit(1)
  return rows[0] ?? null
}

export const listCiSources = async (): Promise<Result<CiSourcePublic[]>> => {
  const rows = await db
    .select(safeColumns)
    .from(ciSources)
    .orderBy(ciSources.name)

  return ok(rows as CiSourcePublic[])
}

export const createCiSource = async (
  input: CreateCiSourceInput,
  actorId?: number,
): Promise<Result<CiSourcePublic>> => {
  const [source] = await db
    .insert(ciSources)
    .values(input)
    .returning(safeColumns)

  // Name and URL only. `input` also carries the access token, and an audit log an
  // admin can read must not become the place to find it.
  await logAudit(
    actorId ?? null,
    'ci_source.created',
    source.id,
    `Created ${input.provider} source ${input.name} at ${input.url}`,
  )

  return ok(source as CiSourcePublic)
}

export const getCiSourceById = async (id: number): Promise<Result<CiSourcePublic>> => {
  const rows = await db
    .select(safeColumns)
    .from(ciSources)
    .where(eq(ciSources.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0] as CiSourcePublic)
}

export const updateCiSource = async (
  id: number,
  input: UpdateCiSourceInput,
  actorId?: number,
): Promise<Result<CiSourcePublic>> => {
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  const [updated] = await db
    .update(ciSources)
    .set(input)
    .where(eq(ciSources.id, id))
    .returning(safeColumns)

  if (!updated) return err(404, 'Not found')

  // Field names only — `accessToken` is one of them, and rotating it is exactly
  // the event worth recording; its value is not.
  await logAudit(actorId ?? null, 'ci_source.updated', id, changedFields(input))

  return ok(updated as CiSourcePublic)
}

export const deleteCiSource = async (id: number, actorId?: number): Promise<Result<void>> => {
  // The deleteEnvironment shape: checks and DELETE in one transaction under a
  // FOR UPDATE lock on the row, so a concurrent insert of a referencing row
  // cannot land between the pre-check and the delete.
  return db.transaction(async (tx): Promise<Result<void>> => {
    const existing = await tx
      .select({ id: ciSources.id, name: ciSources.name })
      .from(ciSources)
      .where(eq(ciSources.id, id))
      .for('update')
      .limit(1)
    if (!existing.length) return err(404, 'Not found')

    // deployment_environments.ci_source_id is NOT NULL with no ON DELETE clause,
    // so the bare delete raised 23503 and escaped as an unhandled 500.
    const envRefs = await tx
      .select({ name: deploymentEnvironments.name })
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.ciSourceId, id))

    if (envRefs.length > 0) {
      return err(
        409,
        `Cannot delete CI source: ${envRefs.length} deployment environment(s) still use it (${envRefs.map((e) => e.name).join(', ')}). Point them at another source first.`,
      )
    }

    const deleted = await tx
      .delete(ciSources)
      .where(eq(ciSources.id, id))
      .returning({ id: ciSources.id })

    if (!deleted.length) return err(404, 'Not found')

    await logAuditWith(tx, actorId ?? null, 'ci_source.deleted', id, `Deleted CI source ${existing[0].name}`)

    return ok(undefined)
  })
}

export const listCiProjects = async (
  sourceId: number,
  search?: string,
): Promise<Result<CiProject[]>> => {
  const source = await getSourceOrErr(sourceId)
  if (!source) return err(404, 'CI source not found')

  const ciProjects = await listProjects(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    search,
  )
  return ok(ciProjects)
}

export const listCiBranches = async (
  sourceId: number,
  projectId: string,
): Promise<Result<CiBranch[]>> => {
  const source = await getSourceOrErr(sourceId)
  if (!source) return err(404, 'CI source not found')

  const branches = await listBranches(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    projectId,
  )
  return ok(branches)
}

export const listCiFiles = async (
  sourceId: number,
  projectId: string,
  branch: string,
  path?: string,
): Promise<Result<CiFile[]>> => {
  const source = await getSourceOrErr(sourceId)
  if (!source) return err(404, 'CI source not found')

  const files = await listFiles(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    projectId,
    branch,
    path,
  )
  return ok(files)
}

export const importCiVars = async (
  sourceId: number,
  projectId: string,
  branch: string,
  filePath: string,
): Promise<Result<unknown>> => {
  const source = await getSourceOrErr(sourceId)
  if (!source) return err(404, 'CI source not found')

  const content = await getFileContent(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    projectId,
    branch,
    filePath,
  )

  const parameters = parseTerraformVariables(content)
  return ok(parameters)
}
