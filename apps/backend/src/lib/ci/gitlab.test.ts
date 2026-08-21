import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  triggerGitLabPipeline,
  listGitLabProjects,
  listGitLabBranches,
  getGitLabApplyTraces,
  gitlabProjectRefFromTriggerUrl,
} from './gitlab'

const jsonResponse = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const pageResponse = (body: unknown, nextPage?: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(nextPage ? { 'x-next-page': nextPage } : {}),
    },
  })

describe('triggerGitLabPipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends ref=main by default (regression: GitLab returns 400 "ref is missing" otherwise)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ id: 42 }))

    await triggerGitLabPipeline(
      'https://gitlab.example.com/api/v4/projects/8/trigger/pipeline',
      'glptt-test',
      { HOSTNAME: 'web-01' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('ref')).toBe('main')
    expect(body.get('token')).toBe('glptt-test')
    expect(body.get('variables[HOSTNAME]')).toBe('web-01')
  })

  it('respects variables.REF override and does not emit it as a variable', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ id: 99 }))

    await triggerGitLabPipeline(
      'https://gitlab.example.com/api/v4/projects/8/trigger/pipeline',
      'glptt-test',
      { REF: 'staging', HOSTNAME: 'web-02' },
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('ref')).toBe('staging')
    expect(body.get('variables[REF]')).toBeNull()
    expect(body.get('variables[HOSTNAME]')).toBe('web-02')
  })

  it('throws a descriptive error on non-2xx from GitLab', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"404 Not Found"}', { status: 404 }),
    )
    await expect(
      triggerGitLabPipeline('https://gitlab.example.com/api/v4/projects/8/trigger/pipeline', 't', {}),
    ).rejects.toThrow(/404/)
  })
})

describe('GitLab list pagination (X-Next-Page)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('follows X-Next-Page and concatenates all pages of projects', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        pageResponse([{ id: 1, name: 'a', path_with_namespace: 'org/a' }], '2'),
      )
      .mockResolvedValueOnce(
        pageResponse([{ id: 2, name: 'b', path_with_namespace: 'org/b' }]),
      )

    const projects = await listGitLabProjects('https://gitlab.example.com', 'tok')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('page=1')
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2')
    expect(projects).toEqual([
      { id: '1', name: 'a', fullPath: 'org/a' },
      { id: '2', name: 'b', fullPath: 'org/b' },
    ])
  })

  it('stops after a single page when no X-Next-Page header is present', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(pageResponse([{ name: 'main' }]))

    const branches = await listGitLabBranches('https://gitlab.example.com', 'tok', '42')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(branches).toEqual([{ name: 'main' }])
  })

  it('caps at 10 pages even if X-Next-Page never clears', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async () => pageResponse([{ id: 1, name: 'x', path_with_namespace: 'o/x' }], '99'))

    const projects = await listGitLabProjects('https://gitlab.example.com', 'tok')

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(projects.length).toBe(10)
  })
})


// Issue #121. The portal used to ask GitLab for `/api/v4/pipelines/:id/jobs` and
// `/api/v4/jobs/:id/trace` — two endpoints the API does not have — and the 404 was
// swallowed, so no order ever recorded outputs. These tests assert the URLs, not
// only the parsed result: a path regression has to fail here rather than quietly
// degrade to an empty map again.
describe('gitlabProjectRefFromTriggerUrl', () => {
  it('takes the numeric project id out of a trigger URL', () => {
    expect(
      gitlabProjectRefFromTriggerUrl('https://gitlab.example.com/api/v4/projects/42/trigger/pipeline'),
    ).toBe('42')
  })

  it('keeps an encoded project path encoded (re-encoding would make %2F into %252F)', () => {
    expect(
      gitlabProjectRefFromTriggerUrl(
        'https://gitlab.example.com/api/v4/projects/group%2Finfra-templates/trigger/pipeline',
      ),
    ).toBe('group%2Finfra-templates')
  })

  it('returns null when the URL names no project', () => {
    expect(gitlabProjectRefFromTriggerUrl('https://gitlab.example.com/api/v4/trigger')).toBeNull()
  })
})

describe('getGitLabApplyTraces', () => {
  const APPLY_LOG = 'Apply complete!\n\nOutputs:\n\nip = "203.0.113.7"\n'

  /** Routes a fetch mock by URL, so each test only states the topology it needs. */
  const routeFetch = (routes: Record<string, unknown>) =>
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const match = Object.keys(routes).find((suffix) => url.endsWith(suffix))
      if (match === undefined) return new Response('{"message":"404 Not Found"}', { status: 404 })
      const body = routes[match]
      return typeof body === 'string'
        ? new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
    })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('follows the bridge to the child pipeline and reads its apply job, project-scoped', async () => {
    // The documented Pattern 1: the pipeline the portal triggered holds nothing but
    // the dispatch bridge; validate/plan/apply runs in the pipeline it starts.
    const fetchMock = routeFetch({
      '/api/v4/projects/8/pipelines/42/jobs': [
        { id: 100, name: 'trigger-linode-virtual-machine', status: 'success' },
      ],
      '/api/v4/projects/8/pipelines/42/bridges': [
        { downstream_pipeline: { id: 43, project_id: 8 } },
      ],
      '/api/v4/projects/8/pipelines/43/jobs': [
        { id: 101, name: 'plan', status: 'success' },
        { id: 102, name: 'apply', status: 'success' },
      ],
      '/api/v4/projects/8/pipelines/43/bridges': [],
      '/api/v4/projects/8/jobs/102/trace': APPLY_LOG,
    })

    const traces = await getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42')

    expect(traces).toEqual([APPLY_LOG])
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    // Every request project-scoped, and none to the endpoints that do not exist.
    expect(urls.every((url) => url.includes('/api/v4/projects/'))).toBe(true)
    expect(urls).not.toContain('https://gitlab.example.com/api/v4/pipelines/42/jobs')
    expect(urls).toContain('https://gitlab.example.com/api/v4/projects/8/jobs/102/trace')
    // The token travels on every one of them.
    expect(fetchMock.mock.calls.every((call) => 'PRIVATE-TOKEN' in Object(call[1]?.headers))).toBe(true)
  })

  it('collects one trace per applying step of an orchestrated stack', async () => {
    // Pattern 3: the orchestrator applies nothing itself, each step pipeline does.
    routeFetch({
      '/api/v4/projects/8/pipelines/42/jobs': [],
      '/api/v4/projects/8/pipelines/42/bridges': [
        { downstream_pipeline: { id: 51, project_id: 8 } },
        { downstream_pipeline: { id: 52, project_id: 9 } },
      ],
      '/api/v4/projects/8/pipelines/51/jobs': [{ id: 201, name: 'apply', status: 'success' }],
      '/api/v4/projects/8/pipelines/51/bridges': [],
      '/api/v4/projects/9/pipelines/52/jobs': [{ id: 202, name: 'apply: [dns]', status: 'success' }],
      '/api/v4/projects/9/pipelines/52/bridges': [],
      '/api/v4/projects/8/jobs/201/trace': 'Outputs:\n\nvm_ip = "10.0.0.4"',
      '/api/v4/projects/9/jobs/202/trace': 'Outputs:\n\nfqdn = "web-01.example.com"',
    })

    const traces = await getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42')

    expect(traces).toEqual(['Outputs:\n\nvm_ip = "10.0.0.4"', 'Outputs:\n\nfqdn = "web-01.example.com"'])
  })

  it('skips an apply job that did not succeed', async () => {
    // A failed apply prints no outputs, and reading its log would report the
    // deployment as one that declared none.
    routeFetch({
      '/api/v4/projects/8/pipelines/42/jobs': [{ id: 100, name: 'apply', status: 'failed' }],
      '/api/v4/projects/8/pipelines/42/bridges': [],
      '/api/v4/projects/8/jobs/100/trace': APPLY_LOG,
    })

    expect(await getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42')).toEqual([])
  })

  it('keeps the traces it already has when the bridges endpoint cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    routeFetch({
      '/api/v4/projects/8/pipelines/42/jobs': [{ id: 100, name: 'apply', status: 'success' }],
      '/api/v4/projects/8/jobs/100/trace': APPLY_LOG,
      // no /bridges route: the mock answers 404
    })

    expect(await getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42')).toEqual([APPLY_LOG])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('child pipelines'), expect.anything())
    warn.mockRestore()
  })

  it('throws when the pipeline itself cannot be read, rather than reporting no outputs', async () => {
    routeFetch({})
    await expect(
      getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42'),
    ).rejects.toThrow(/GitLab jobs fetch failed: 404/)
  })

  it('terminates on a bridge that points back at a pipeline already visited', async () => {
    const fetchMock = routeFetch({
      '/api/v4/projects/8/pipelines/42/jobs': [],
      '/api/v4/projects/8/pipelines/42/bridges': [{ downstream_pipeline: { id: 42, project_id: 8 } }],
    })

    expect(await getGitLabApplyTraces('https://gitlab.example.com', 'tok', '8', '42')).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
