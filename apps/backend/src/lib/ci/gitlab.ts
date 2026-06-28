import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

const validateWebUrl = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Disallowed URL protocol: ${parsed.protocol}`)
  }
  return url
}

export const triggerGitLabPipeline = async (
  webhookUrl: string,
  token: string,
  variables: Record<string, string>,
): Promise<string> => {
  const body = new URLSearchParams()
  body.append('token', token)
  for (const [key, value] of Object.entries(variables)) {
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

  const res = await fetch(`${validateWebUrl(apiUrl)}/api/v4/projects?${params}`, {
    headers: { 'PRIVATE-TOKEN': accessToken },
  })

  if (!res.ok) throw new Error(`GitLab list projects failed: ${res.status}`)

  const data = await res.json() as Array<{ id: number; name: string; path_with_namespace: string }>
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
  const res = await fetch(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${encodeURIComponent(projectId)}/repository/branches?per_page=100`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )

  if (!res.ok) throw new Error(`GitLab list branches failed: ${res.status}`)

  const data = await res.json() as Array<{ name: string }>
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
  const res = await fetch(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${encodeURIComponent(projectId)}/repository/tree?${params}`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )

  if (!res.ok) throw new Error(`GitLab list files failed: ${res.status}`)

  const data = await res.json() as Array<{ name: string; path: string; type: 'blob' | 'tree' }>
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
