import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

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

  const res = await fetch(
    search
      ? `https://api.github.com/search/repositories?q=${encodeURIComponent(search)}&per_page=100`
      : `https://api.github.com/user/repos?${params}`,
    { headers: ghHeaders(token) },
  )

  if (!res.ok) throw new Error(`GitHub list repos failed: ${res.status}`)

  const data = await res.json() as {
    items?: Array<{ id: number; name: string; full_name: string }>
  } | Array<{ id: number; name: string; full_name: string }>

  const repos = Array.isArray(data) ? data : (data.items ?? [])
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
  const res = await fetch(
    `https://api.github.com/repos/${projectId}/branches?per_page=100`,
    { headers: ghHeaders(token) },
  )

  if (!res.ok) throw new Error(`GitHub list branches failed: ${res.status}`)

  const data = await res.json() as Array<{ name: string }>
  return data.map((b) => ({ name: b.name }))
}

export const listGitHubFiles = async (
  _apiUrl: string,
  token: string,
  projectId: string,
  branch: string,
  path: string,
): Promise<CiFile[]> => {
  const res = await fetch(
    `https://api.github.com/repos/${projectId}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token) },
  )

  if (!res.ok) throw new Error(`GitHub list files failed: ${res.status}`)

  const data = await res.json() as Array<{
    name: string
    path: string
    type: 'file' | 'dir' | 'symlink' | 'submodule'
  }>

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
  const res = await fetch(
    `https://api.github.com/repos/${projectId}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
    { headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' } },
  )

  if (!res.ok) throw new Error(`GitHub file content fetch failed: ${res.status}`)

  return res.text()
}
