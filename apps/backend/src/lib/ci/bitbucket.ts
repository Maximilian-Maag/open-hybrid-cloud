import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

const bbHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

// Parse workspace/repo-slug from a Bitbucket repo URL
const parseRepoUrl = (repoUrl: string): { workspace: string; repoSlug: string } => {
  const url = new URL(repoUrl)
  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
  return { workspace: parts[0], repoSlug: parts[1] }
}

export const triggerBitbucketPipeline = async (
  repoUrl: string,
  token: string,
  branch: string,
  variables: Record<string, string>,
): Promise<string> => {
  const { workspace, repoSlug } = parseRepoUrl(repoUrl)

  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pipelines/`,
    {
      method: 'POST',
      headers: bbHeaders(token),
      body: JSON.stringify({
        target: { ref_type: 'branch', type: 'pipeline_ref_target', ref_name: branch },
        variables: Object.entries(variables).map(([key, value]) => ({
          key,
          value,
          secured: false,
        })),
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bitbucket pipeline trigger failed: ${res.status} ${text}`)
  }

  const json = await res.json() as { uuid: string }
  return json.uuid
}

export const listBitbucketRepos = async (
  _apiUrl: string,
  token: string,
  search?: string,
): Promise<CiProject[]> => {
  const params = new URLSearchParams({ pagelen: '100', role: 'member' })
  if (search) params.set('q', `full_name ~ "${search}"`)

  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories?${params}`,
    { headers: bbHeaders(token) },
  )

  if (!res.ok) throw new Error(`Bitbucket list repos failed: ${res.status}`)

  const data = await res.json() as {
    values: Array<{ uuid: string; name: string; full_name: string }>
  }

  return data.values.map((r) => ({
    id: r.uuid,
    name: r.name,
    fullPath: r.full_name,
  }))
}

export const listBitbucketBranches = async (
  _apiUrl: string,
  token: string,
  projectId: string,
): Promise<CiBranch[]> => {
  // projectId is workspace/repoSlug
  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${projectId}/refs/branches?pagelen=100`,
    { headers: bbHeaders(token) },
  )

  if (!res.ok) throw new Error(`Bitbucket list branches failed: ${res.status}`)

  const data = await res.json() as { values: Array<{ name: string }> }
  return data.values.map((b) => ({ name: b.name }))
}

export const listBitbucketFiles = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  path: string,
): Promise<CiFile[]> => {
  const normalizedPath = path ? `/${path}` : ''
  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${projectId}/src/${encodeURIComponent(branch)}${normalizedPath}?pagelen=100`,
    { headers: bbHeaders(token) },
  )

  if (!res.ok) throw new Error(`Bitbucket list files failed: ${res.status}`)

  const data = await res.json() as {
    values: Array<{ path: string; type: 'commit_file' | 'commit_directory' }>
  }

  return data.values.map((f) => ({
    name: f.path.split('/').pop() ?? f.path,
    path: f.path,
    type: f.type === 'commit_directory' ? 'tree' : 'blob',
  }))
}

export const getBitbucketFileContent = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  filePath: string,
): Promise<string> => {
  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${projectId}/src/${encodeURIComponent(branch)}/${filePath}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) throw new Error(`Bitbucket file content fetch failed: ${res.status}`)

  return res.text()
}
