import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listProjects, listBranches, listFiles, getFileContent } from '@/lib/ci'
import { parseTerraformVariables } from '@/lib/tfparser'
import { ok, err, type Result } from '@/lib/services/result'
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

export const createCiSource = async (input: CreateCiSourceInput): Promise<Result<CiSourcePublic>> => {
  const [source] = await db
    .insert(ciSources)
    .values(input)
    .returning(safeColumns)

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
): Promise<Result<CiSourcePublic>> => {
  const [updated] = await db
    .update(ciSources)
    .set(input)
    .where(eq(ciSources.id, id))
    .returning(safeColumns)

  if (!updated) return err(404, 'Not found')
  return ok(updated as CiSourcePublic)
}

export const deleteCiSource = async (id: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(ciSources)
    .where(eq(ciSources.id, id))
    .returning({ id: ciSources.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
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
