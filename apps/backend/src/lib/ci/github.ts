import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

// See gitlab.ts — cap pages followed so a large org isn't truncated at 100 rows
// while still bounding the number of requests.
const MAX_LIST_PAGES = 10

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

// Extract the rel="next" URL from a GitHub `Link` header, if present.
// Format: <https://api.github.com/...&page=2>; rel="next", <...>; rel="last"
const parseNextLink = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/)
    if (match) return match[1]
  }
  return null
}

/**
 * Follow GitHub's `Link: rel="next"` pagination, concatenating each page.
 * `extract` pulls the row array out of the page body (repos search wraps rows in
 * `items`, other endpoints return a bare array).
 */
const githubListAll = async <T>(
  firstUrl: string,
  token: string,
  errorLabel: string,
  extract: (body: unknown) => T[],
): Promise<T[]> => {
  const results: T[] = []
  let url: string | null = firstUrl

  for (let i = 0; i < MAX_LIST_PAGES && url; i++) {
    const res: Response = await fetch(url, { headers: ghHeaders(token) })
    if (!res.ok) throw new Error(`${errorLabel}: ${res.status}`)
    results.push(...extract(await res.json()))
    url = parseNextLink(res.headers.get('link'))
  }

  return results
}

// repoUrl: e.g. https://github.com/owner/repo
const parseRepoUrl = (repoUrl: string): { owner: string; repo: string } => {
  const url = new URL(repoUrl)
  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
  return { owner: parts[0], repo: parts[1] }
}

export const triggerGitHubWorkflow = async (
  repoUrl: string,
  token: string,
  workflow: string,
  branch: string,
  inputs: Record<string, string>,
): Promise<string> => {
  const { owner, repo } = parseRepoUrl(repoUrl)
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: branch, inputs }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub workflow dispatch failed: ${res.status} ${text}`)
  }

  // GitHub workflow_dispatch returns 204 with no body; return a synthetic ID
  return `${owner}/${repo}/${workflow}@${branch}`
}

export const listGitHubRepos = async (
  _apiUrl: string,
  token: string,
  search?: string,
): Promise<CiProject[]> => {
  const params = new URLSearchParams({ per_page: '100', visibility: 'all' })
  if (search) params.set('q', search)

  type Repo = { id: number; name: string; full_name: string }
  const repos = await githubListAll<Repo>(
    search
      ? `https://api.github.com/search/repositories?q=${encodeURIComponent(search)}&per_page=100`
      : `https://api.github.com/user/repos?${params}`,
    token,
    'GitHub list repos failed',
    (body) =>
      Array.isArray(body)
        ? (body as Repo[])
        : ((body as { items?: Repo[] }).items ?? []),
  )

  return repos.map((r) => ({
    id: String(r.id),
    name: r.name,
    fullPath: r.full_name,
  }))
}

export const listGitHubBranches = async (
  _apiUrl: string,
  token: string,
  projectId: string,
): Promise<CiBranch[]> => {
  // projectId is owner/repo
  const data = await githubListAll<{ name: string }>(
    `https://api.github.com/repos/${projectId}/branches?per_page=100`,
    token,
    'GitHub list branches failed',
    (body) => body as Array<{ name: string }>,
  )
  return data.map((b) => ({ name: b.name }))
}

export const listGitHubFiles = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  path: string,
): Promise<CiFile[]> => {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  type Entry = { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'submodule' }
  const data = await githubListAll<Entry>(
    `https://api.github.com/repos/${projectId}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    token,
    'GitHub list files failed',
    (body) => (Array.isArray(body) ? (body as Entry[]) : []),
  )

  return data.map((f) => ({
    name: f.name,
    path: f.path,
    type: f.type === 'dir' ? 'tree' : 'blob',
  }))
}

export const getGitHubFileContent = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  filePath: string,
): Promise<string> => {
  const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(
    `https://api.github.com/repos/${projectId}/contents/${encodedFilePath}?ref=${encodeURIComponent(branch)}`,
    { headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' } },
  )

  if (!res.ok) throw new Error(`GitHub file content fetch failed: ${res.status}`)

  return res.text()
}
