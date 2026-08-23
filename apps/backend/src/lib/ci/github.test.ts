import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  triggerGitHubWorkflow,
  listGitHubRepos,
  listGitHubBranches,
  listGitHubFiles,
  getGitHubFileContent,
} from './github'

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const linkedRes = (body: unknown, nextUrl?: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(nextUrl ? { link: `<${nextUrl}>; rel="next", <${nextUrl}>; rel="last"` } : {}),
    },
  })

describe('github ci client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('triggerGitHubWorkflow', () => {
    it('POSTs to workflow_dispatch with ref + inputs and returns a synthetic id', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

      const id = await triggerGitHubWorkflow(
        'https://github.com/acme/infra',
        'ghp_token',
        'deploy.yml',
        'main',
        { HOSTNAME: 'web-01' },
      )

      expect(id).toBe('acme/infra/deploy.yml@main')
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://api.github.com/repos/acme/infra/actions/workflows/deploy.yml/dispatches')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({ ref: 'main', inputs: { HOSTNAME: 'web-01' } })
      const headers = new Headers(init?.headers as HeadersInit)
      expect(headers.get('authorization')).toBe('Bearer ghp_token')
    })

    it('throws a descriptive error on non-2xx', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{"message":"Not Found"}', { status: 404 }))
      await expect(
        triggerGitHubWorkflow('https://github.com/a/b', 't', 'w.yml', 'main', {}),
      ).rejects.toThrow(/404/)
      errSpy.mockRestore()
    })

    // Issue #144, and the worst of the three: GitHub answers an invalid
    // workflow_dispatch with a 422 that lists the offending INPUTS verbatim — the
    // order's parameter values, sensitive ones included — and that body used to be
    // spliced straight into a message that reaches a 502 body and logAudit.
    it('keeps the provider response body out of the thrown message', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          '{"message":"Unexpected inputs provided: [\\"ADMIN_PASSWORD: sup3rs3cret\\"]"}',
          { status: 422 },
        ),
      )

      await expect(
        triggerGitHubWorkflow('https://github.com/a/b', 't', 'w.yml', 'main', {
          ADMIN_PASSWORD: 'sup3rs3cret',
        }),
      ).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('sup3rs3cret') }),
      )

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('422'),
        expect.stringContaining('sup3rs3cret'),
      )
      errSpy.mockRestore()
    })
  })

  describe('listGitHubRepos', () => {
    it('lists user repos as CiProject[] when no search term', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        jsonRes([{ id: 1, name: 'infra', full_name: 'acme/infra' }, { id: 2, name: 'ops', full_name: 'acme/ops' }]),
      )
      const repos = await listGitHubRepos('https://api.github.com', 'tok')
      expect(fetchMock.mock.calls[0][0]).toContain('/user/repos')
      expect(repos).toEqual([
        { id: '1', name: 'infra', fullPath: 'acme/infra' },
        { id: '2', name: 'ops', fullPath: 'acme/ops' },
      ])
    })

    it('uses the search endpoint and unwraps items[] when search is provided', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        jsonRes({ items: [{ id: 5, name: 'stuff', full_name: 'acme/stuff' }] }),
      )
      const repos = await listGitHubRepos('https://api.github.com', 'tok', 'stuff')
      expect(fetchMock.mock.calls[0][0]).toContain('/search/repositories')
      expect(fetchMock.mock.calls[0][0]).toContain('q=stuff')
      expect(repos).toEqual([{ id: '5', name: 'stuff', fullPath: 'acme/stuff' }])
    })

    it('throws on non-2xx', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
      await expect(listGitHubRepos('https://api.github.com', 'tok')).rejects.toThrow(/500/)
    })

    it('follows the Link rel="next" header and concatenates pages', async () => {
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          linkedRes(
            [{ id: 1, name: 'infra', full_name: 'acme/infra' }],
            'https://api.github.com/user/repos?page=2',
          ),
        )
        .mockResolvedValueOnce(jsonRes([{ id: 2, name: 'ops', full_name: 'acme/ops' }]))

      const repos = await listGitHubRepos('https://api.github.com', 'tok')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.github.com/user/repos?page=2')
      expect(repos).toEqual([
        { id: '1', name: 'infra', fullPath: 'acme/infra' },
        { id: '2', name: 'ops', fullPath: 'acme/ops' },
      ])
    })

    it('caps at 10 pages if the Link header always points to a next page', async () => {
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockImplementation(async () =>
          linkedRes(
            [{ id: 1, name: 'r', full_name: 'acme/r' }],
            'https://api.github.com/user/repos?page=next',
          ),
        )

      const repos = await listGitHubRepos('https://api.github.com', 'tok')
      expect(fetchMock).toHaveBeenCalledTimes(10)
      expect(repos.length).toBe(10)
    })
  })

  describe('listGitHubBranches', () => {
    it('returns CiBranch[] for /repos/:owner/:repo/branches', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes([{ name: 'main' }, { name: 'dev' }]))
      const branches = await listGitHubBranches('https://api.github.com', 'tok', 'acme/infra')
      expect(branches).toEqual([{ name: 'main' }, { name: 'dev' }])
    })

    it('throws on non-2xx', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 403 }))
      await expect(listGitHubBranches('https://api.github.com', 'tok', 'acme/infra')).rejects.toThrow(/403/)
    })
  })

  describe('listGitHubFiles', () => {
    it('maps GitHub `dir` type to `tree`, others to `blob`', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        jsonRes([
          { name: 'main.tf', path: 'templates/vm/main.tf', type: 'file' },
          { name: 'modules', path: 'templates/vm/modules', type: 'dir' },
        ]),
      )
      const files = await listGitHubFiles('https://api.github.com', 'tok', 'acme/infra', 'main', 'templates/vm')
      expect(files).toEqual([
        { name: 'main.tf', path: 'templates/vm/main.tf', type: 'blob' },
        { name: 'modules', path: 'templates/vm/modules', type: 'tree' },
      ])
    })

    it('percent-encodes path segments', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes([]))
      await listGitHubFiles('https://api.github.com', 'tok', 'acme/infra', 'main', 'has space/dir')
      const url = String(fetchMock.mock.calls[0][0])
      expect(url).toContain('/contents/has%20space/dir')
    })
  })

  describe('getGitHubFileContent', () => {
    it('requests raw content and returns it verbatim', async () => {
      const raw = 'variable "hostname" {\n  type = string\n}\n'
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(raw, { status: 200 }))
      const content = await getGitHubFileContent('https://api.github.com', 'tok', 'acme/infra', 'main', 'variables.tf')
      expect(content).toBe(raw)
      const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit)
      expect(headers.get('accept')).toContain('vnd.github.raw+json')
    })
  })
})
