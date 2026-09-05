import type { CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'
import { triggerFailure } from './triggerError'
import { insecureTransportRefusal } from './transport'

// Cap on pages followed for any list endpoint. Guards against unbounded loops
// (e.g. a broken/looping X-Next-Page header) while still covering large orgs:
// 10 pages × per_page=100 = 1000 items.
const MAX_LIST_PAGES = 10

/**
 * The gate every outbound GitLab URL passes through.
 *
 * It used to reject `file:` and `gopher:` and then permit plaintext http to any
 * host — while each of these calls carries a credential (#329). See
 * `transport.ts` for what is refused and for the operator opt-out.
 */
const validateWebUrl = (url: string): string => {
  const refusal = insecureTransportRefusal(url)
  if (refusal) throw new Error(refusal)
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

  if (!res.ok) throw await triggerFailure('GitLab pipeline trigger', res)

  const json = await res.json() as { id: number }
  return String(json.id)
}

/**
 * The project a pipeline ran in, taken from a deployment environment's trigger URL.
 *
 * Every read endpoint GitLab offers for pipelines and jobs is project-scoped, but a
 * CI source stores only the host (`https://gitlab.example.com`) because the list
 * endpoints append `/api/v4/projects` themselves. The project is named exactly once
 * in the whole system — in the environment's webhook URL:
 *
 *   https://gitlab.example.com/api/v4/projects/42/trigger/pipeline
 *   https://gitlab.example.com/api/v4/projects/group%2Frepo/trigger/pipeline
 *
 * The segment is returned exactly as it appears: GitLab wants the path form
 * URL-encoded, so re-encoding it here would turn `%2F` into `%252F`.
 */
export const gitlabProjectRefFromTriggerUrl = (webhookUrl: string): string | null =>
  /\/projects\/([^/?#]+)/.exec(webhookUrl)?.[1] ?? null

type GitLabJob = { id: number; name: string; status?: string }
type GitLabBridge = { downstream_pipeline?: { id: number; project_id?: number } | null }

/**
 * How far down the pipeline tree to look for an apply job.
 *
 * Two levels is what the documented patterns need (entry → template, and
 * orchestrator → step), the third is slack for a template that dispatches once
 * more. The `seen` set below is what actually guarantees termination; this only
 * bounds the request count.
 */
const MAX_PIPELINE_DEPTH = 3

/**
 * `apply`, `apply: [dns]` (parallel matrix), `apply-dns` — all the ways a template
 * can name the job whose stdout carries the `Outputs:` block. Deliberately not
 * "any job": reading the wrong job's log would invent outputs from a plan.
 */
const isApplyJob = (name: string): boolean => /^apply\b/.test(name)

export const getGitLabJobTrace = async (
  apiUrl: string,
  accessToken: string,
  projectRef: string,
  jobId: string,
): Promise<string> => {
  const res = await fetch(
    `${validateWebUrl(apiUrl)}/api/v4/projects/${projectRef}/jobs/${jobId}/trace`,
    { headers: { 'PRIVATE-TOKEN': accessToken } },
  )
  if (!res.ok) throw new Error(`GitLab job trace fetch failed: ${res.status}`)
  return res.text()
}

/**
 * The stdout of every apply job below the pipeline the portal triggered.
 *
 * Not just "the jobs of that pipeline": the entry pipeline the trigger API returns
 * an id for holds nothing but `trigger-*` bridge jobs (`stage: dispatch`), and
 * `validate → plan → apply` runs in the child pipeline they start — a pipeline whose
 * jobs `/pipelines/:id/jobs` does not list, at all. Reading only the triggered
 * pipeline is why no order ever recorded outputs (issue #121); the bridges are
 * followed instead, down to whatever depth the templates dispatch to.
 *
 * All apply jobs rather than the first, because a pipeline stack is several steps
 * that each apply and each print their own outputs.
 */
export const getGitLabApplyTraces = async (
  apiUrl: string,
  accessToken: string,
  projectRef: string,
  pipelineId: string,
): Promise<string[]> => {
  const baseUrl = validateWebUrl(apiUrl)
  const traces: string[] = []
  const seen = new Set<string>()

  const walk = async (project: string, pipeline: string, depth: number): Promise<void> => {
    const key = `${project}/${pipeline}`
    if (seen.has(key)) return
    seen.add(key)

    // Paged: GitLab returns 20 jobs per page, and a template with a longer
    // pipeline would hold `apply` on page 2 — which would look exactly like the
    // bug this walk exists to fix.
    const jobs = await gitlabListAll<GitLabJob>(
      `${baseUrl}/api/v4/projects/${project}/pipelines/${pipeline}/jobs`,
      accessToken,
      'GitLab jobs fetch failed',
    )

    for (const job of jobs) {
      // A failed or skipped apply has no outputs to report, and its log would be
      // read as "this deployment declared none".
      if (!isApplyJob(job.name) || (job.status !== undefined && job.status !== 'success')) continue
      traces.push(await getGitLabJobTrace(baseUrl, accessToken, project, String(job.id)))
    }

    if (depth >= MAX_PIPELINE_DEPTH) return

    let bridges: GitLabBridge[]
    try {
      bridges = await gitlabListAll<GitLabBridge>(
        `${baseUrl}/api/v4/projects/${project}/pipelines/${pipeline}/bridges`,
        accessToken,
        'GitLab bridges fetch failed',
      )
    } catch (err) {
      // Whatever the jobs of this pipeline already yielded is worth more than
      // nothing, so a bridges endpoint that cannot be read (an old GitLab, a token
      // without the scope) narrows the search instead of failing it.
      console.warn(`[ci] Could not list the child pipelines of pipeline ${pipeline}:`, err)
      return
    }

    for (const bridge of bridges) {
      const downstream = bridge.downstream_pipeline
      if (!downstream) continue
      try {
        // A child pipeline is usually in the same project, but a multi-project
        // trigger names its own — and that one is often unreadable with this
        // token. Same rule as the bridges list above: a child that cannot be read
        // narrows the search, it does not fail it, or one 401 would discard the
        // traces the readable pipelines already gave us.
        await walk(
          downstream.project_id === undefined ? project : String(downstream.project_id),
          String(downstream.id),
          depth + 1,
        )
      } catch (err) {
        console.warn(`[ci] Could not read child pipeline ${downstream.id}:`, err)
      }
    }
  }

  await walk(projectRef, pipelineId, 0)
  return traces
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
