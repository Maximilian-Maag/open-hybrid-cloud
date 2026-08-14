import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  triggerGitLabPipeline,
  listGitLabProjects,
  listGitLabBranches,
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
