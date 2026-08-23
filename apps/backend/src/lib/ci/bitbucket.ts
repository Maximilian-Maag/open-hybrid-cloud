import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'
import { triggerFailure } from './triggerError'

// See gitlab.ts — bound the number of pages followed.
const MAX_LIST_PAGES = 10

const bbHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

/**
 * Follow Bitbucket's cursor pagination. Each page body carries a fully-qualified
 * `next` URL for the following page (absent on the last page). Without following
 * it, results were silently truncated to the first `pagelen` rows.
 */
const bitbucketListAll = async <T>(
  firstUrl: string,
  token: string,
  errorLabel: string,
): Promise<T[]> => {
  const results: T[] = []
  let url: string | null = firstUrl

  for (let i = 0; i < MAX_LIST_PAGES && url; i++) {
    const res: Response = await fetch(url, { headers: bbHeaders(token) })
    if (!res.ok) throw new Error(`${errorLabel}: ${res.status}`)
    const data = (await res.json()) as { values?: T[]; next?: string }
    results.push(...(data.values ?? []))
    url = data.next ?? null
  }

  return results
}

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

  if (!res.ok) throw await triggerFailure('Bitbucket pipeline trigger', res)

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

  const values = await bitbucketListAll<{ uuid: string; name: string; full_name: string }>(
    `https://api.bitbucket.org/2.0/repositories?${params}`,
    token,
    'Bitbucket list repos failed',
  )

  return values.map((r) => ({
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
  const values = await bitbucketListAll<{ name: string }>(
    `https://api.bitbucket.org/2.0/repositories/${projectId}/refs/branches?pagelen=100`,
    token,
    'Bitbucket list branches failed',
  )
  return values.map((b) => ({ name: b.name }))
}

export const listBitbucketFiles = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  path: string,
): Promise<CiFile[]> => {
  const normalizedPath = path ? `/${path}` : ''
  const values = await bitbucketListAll<{ path: string; type: 'commit_file' | 'commit_directory' }>(
    `https://api.bitbucket.org/2.0/repositories/${projectId}/src/${encodeURIComponent(branch)}${normalizedPath}?pagelen=100`,
    token,
    'Bitbucket list files failed',
  )

  return values.map((f) => ({
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
