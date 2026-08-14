import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

// Cap on pages followed for any list endpoint. Guards against unbounded loops
// (e.g. a broken/looping X-Next-Page header) while still covering large orgs:
// 10 pages × per_page=100 = 1000 items.
const MAX_LIST_PAGES = 10

const validateWebUrl = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Disallowed URL protocol: ${parsed.protocol}`)
  }
  return url
}

/**
 * Fetch every page of a GitLab list endpoint, following the `X-Next-Page`
 * response header (GitLab sets it to the next page number, or empty on the last
 * page). Without this, results were silently truncated to the first 100 rows.
 */
const gitlabListAll = async <T>(
  baseUrl: string,
  accessToken: string,
  errorLabel: string,
): Promise<T[]> => {
  const results: T[] = []
  let nextPage: string | null = '1'

  for (let i = 0; i < MAX_LIST_PAGES && nextPage; i++) {
    const url = new URL(baseUrl)
    url.searchParams.set('page', nextPage)
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': accessToken } })
    if (!res.ok) throw new Error(`${errorLabel}: ${res.status}`)
    const data = (await res.json()) as T[]
    results.push(...data)
    nextPage = res.headers.get('x-next-page') || null
  }

  return results
}

export const triggerGitLabPipeline = async (
  webhookUrl: string,
  token: string,
  variables: Record<string, string>,
): Promise<string> => {
  const body = new URLSearchParams()
  body.append('token', token)
  // GitLab's trigger endpoint requires `ref` (git ref to run the pipeline
  // against) — omitting it returns 400 "ref is missing". Default to `main`;
  // callers can override by setting variables['REF'].
  body.append('ref', variables['REF'] ?? 'main')
  for (const [key, value] of Object.entries(variables)) {
    if (key === 'REF') continue
    body.append(`variables[${key}]`, value)
  }

  const res = await fetch(validateWebUrl(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitLab pipeline trigger failed: ${res.status} ${text}`)
  }

  const json = await res.json() as { id: number }
  return String(json.id)
}

export const getGitLabJobTrace = async (
  apiUrl: string,
  accessToken: string,
  pipelineId: string,
): Promise<string> => {
  const baseUrl = validateWebUrl(apiUrl)
  const jobsRes = await fetch(
    `${baseUrl}/api/v4/pipelines/${pipelineId}/jobs`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )

  if (!jobsRes.ok) throw new Error(`GitLab jobs fetch failed: ${jobsRes.status}`)

  const jobs = await jobsRes.json() as Array<{ id: number; name: string }>
  const applyJob = jobs.find((j) => j.name === 'apply') ?? jobs[0]

  if (!applyJob) return ''

  const traceRes = await fetch(
    `${baseUrl}/api/v4/jobs/${applyJob.id}/trace`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )

  if (!traceRes.ok) throw new Error(`GitLab job trace fetch failed: ${traceRes.status}`)

  return traceRes.text()
}

export const listGitLabProjects = async (
  apiUrl: string,
  accessToken: string,
  search?: string,
): Promise<CiProject[]> => {
  const params = new URLSearchParams({ membership: 'true', per_page: '100' })
  if (search) params.set('search', search)

  const data = await gitlabListAll<{ id: number; name: string; path_with_namespace: string }>(
    `${validateWebUrl(apiUrl)}/api/v4/projects?${params}`,
    accessToken,
    'GitLab list projects failed',
  )
  return data.map((p) => ({
    id: String(p.id),
    name: p.name,
    fullPath: p.path_with_namespace,
  }))
}

export const listGitLabBranches = async (
  apiUrl: string,
  accessToken: string,
  projectId: string,
): Promise<CiBranch[]> => {
  const data = await gitlabListAll<{ name: string }>(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${encodeURIComponent(projectId)}/repository/branches?per_page=100`,
    accessToken,
    'GitLab list branches failed',
  )
  return data.map((b) => ({ name: b.name }))
}

export const listGitLabFiles = async (
  apiUrl: string,
  accessToken: string,
  projectId: string,
  branch: string,
  path: string,
): Promise<CiFile[]> => {
  const params = new URLSearchParams({ ref: branch, path, per_page: '100' })
  const data = await gitlabListAll<{ name: string; path: string; type: 'blob' | 'tree' }>(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${encodeURIComponent(projectId)}/repository/tree?${params}`,
    accessToken,
    'GitLab list files failed',
  )
  return data.map((f) => ({ name: f.name, path: f.path, type: f.type }))
}

export const getGitLabFileContent = async (
  apiUrl: string,
  accessToken: string,
  projectId: string,
  branch: string,
  filePath: string,
): Promise<string> => {
  const params = new URLSearchParams({ ref: branch })
  const encodedPath = encodeURIComponent(filePath)
  const res = await fetch(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}/raw?${params}`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )

  if (!res.ok) throw new Error(`GitLab file content fetch failed: ${res.status}`)

  return res.text()
}
