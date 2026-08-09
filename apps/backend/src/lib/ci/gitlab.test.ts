import { describe, it, expect, beforeEach, vi } from 'vitest'
import { triggerGitLabPipeline } from './gitlab'

const jsonResponse = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
