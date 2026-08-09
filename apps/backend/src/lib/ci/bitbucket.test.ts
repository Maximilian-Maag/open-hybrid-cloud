import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  triggerBitbucketPipeline,
  listBitbucketRepos,
  listBitbucketBranches,
  listBitbucketFiles,
  getBitbucketFileContent,
} from './bitbucket'

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('bitbucket ci client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('triggerBitbucketPipeline', () => {
    it('POSTs a pipeline_ref_target with variables mapped to Bitbucket key/value objects', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ uuid: '{abc-uuid}' }, 201))

      const id = await triggerBitbucketPipeline(
        'https://bitbucket.org/acme/infra',
        'app-pw',
        'main',
        { HOSTNAME: 'web-01', REGION: 'eu-west' },
      )

      expect(id).toBe('{abc-uuid}')
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('https://api.bitbucket.org/2.0/repositories/acme/infra/pipelines/')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body.target).toEqual({ ref_type: 'branch', type: 'pipeline_ref_target', ref_name: 'main' })
      expect(body.variables).toEqual([
        { key: 'HOSTNAME', value: 'web-01', secured: false },
        { key: 'REGION', value: 'eu-west', secured: false },
      ])
    })

    it('throws with the response body on non-2xx', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{"error":{"message":"nope"}}', { status: 401 }))
      await expect(
        triggerBitbucketPipeline('https://bitbucket.org/a/b', 't', 'main', {}),
      ).rejects.toThrow(/401/)
    })
  })

  describe('listBitbucketRepos', () => {
    it('lists role=member repos when no search term', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        jsonRes({ values: [{ uuid: '{u1}', name: 'infra', full_name: 'acme/infra' }] }),
      )
      const repos = await listBitbucketRepos('https://api.bitbucket.org', 'tok')
      expect(String(fetchMock.mock.calls[0][0])).toContain('role=member')
      expect(repos).toEqual([{ id: '{u1}', name: 'infra', fullPath: 'acme/infra' }])
    })

    it('encodes the search term as full_name ~ "..." query', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ values: [] }))
      await listBitbucketRepos('https://api.bitbucket.org', 'tok', 'infra')
      const url = new URL(String(fetchMock.mock.calls[0][0]))
      expect(url.searchParams.get('q')).toBe('full_name ~ "infra"')
    })
  })

  describe('listBitbucketBranches', () => {
    it('returns CiBranch[] from refs/branches', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ values: [{ name: 'main' }, { name: 'stg' }] }))
      const b = await listBitbucketBranches('https://api.bitbucket.org', 'tok', 'acme/infra')
      expect(b).toEqual([{ name: 'main' }, { name: 'stg' }])
    })
  })

  describe('listBitbucketFiles', () => {
    it('maps commit_directory → tree, commit_file → blob', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        jsonRes({
          values: [
            { path: 'templates/vm/main.tf', type: 'commit_file' },
            { path: 'templates/vm/modules', type: 'commit_directory' },
          ],
        }),
      )
      const files = await listBitbucketFiles('https://api.bitbucket.org', 'tok', 'acme/infra', 'main', 'templates/vm')
      expect(files).toEqual([
        { name: 'main.tf', path: 'templates/vm/main.tf', type: 'blob' },
        { name: 'modules', path: 'templates/vm/modules', type: 'tree' },
      ])
    })

    it('lists root when path is empty', async () => {
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ values: [] }))
      await listBitbucketFiles('https://api.bitbucket.org', 'tok', 'acme/infra', 'main', '')
      const url = String(fetchMock.mock.calls[0][0])
      // /src/main?... (no trailing /path segment)
      expect(url).toMatch(/\/src\/main\?/)
    })
  })

  describe('getBitbucketFileContent', () => {
    it('returns raw text and 404s bubble up', async () => {
      const raw = 'variable "hostname" {\n  type = string\n}\n'
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(raw, { status: 200 }))
      const content = await getBitbucketFileContent('https://api.bitbucket.org', 'tok', 'acme/infra', 'main', 'variables.tf')
      expect(content).toBe(raw)
    })

    it('throws on 404', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
      await expect(
        getBitbucketFileContent('https://api.bitbucket.org', 'tok', 'acme/infra', 'main', 'gone.tf'),
      ).rejects.toThrow(/404/)
    })
  })
})
