import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci', () => ({
  listProjects: vi.fn().mockResolvedValue([{ id: '1', name: 'proj', path: 'org/proj' }]),
  listBranches: vi.fn().mockResolvedValue([{ name: 'main' }]),
  listFiles: vi.fn().mockResolvedValue([{ name: 'main.tf', type: 'file', path: 'main.tf' }]),
  getFileContent: vi.fn().mockResolvedValue('variable "region" { type = string }'),
}))

vi.mock('@/lib/tfparser', () => ({
  parseTerraformVariables: vi
    .fn()
    .mockReturnValue([
      { name: 'region', type: 'string', description: '', default: '' },
    ]),
}))

import {
  listCiSources,
  createCiSource,
  getCiSourceById,
  updateCiSource,
  deleteCiSource,
  listCiProjects,
  listCiBranches,
  listCiFiles,
  importCiVars,
} from './ciSources'
import {
  listProjects as ciListProjects,
  listBranches as ciListBranches,
  listFiles as ciListFiles,
  getFileContent as ciGetFileContent,
} from '@/lib/ci'
import { parseTerraformVariables } from '@/lib/tfparser'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const mockedListProjects = vi.mocked(ciListProjects)
const mockedListBranches = vi.mocked(ciListBranches)
const mockedListFiles = vi.mocked(ciListFiles)
const mockedGetFileContent = vi.mocked(ciGetFileContent)
const mockedParse = vi.mocked(parseTerraformVariables)

beforeEach(() => {
  mockedListProjects.mockClear()
  mockedListBranches.mockClear()
  mockedListFiles.mockClear()
  mockedGetFileContent.mockClear()
  mockedParse.mockClear()
})

const seedSource = async () => {
  const result = await createCiSource({
    name: 'src1',
    url: 'https://gl.example.com',
    accessToken: 'tok-secret',
    provider: 'gitlab',
  })
  if (!result.ok) throw new Error('seed failed')
  return result.data
}

describe('listCiSources', () => {
  it('returns sources without exposing accessToken', async () => {
    await seedSource()
    const result = await listCiSources()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect((result.data[0] as unknown as { accessToken?: string }).accessToken).toBeUndefined()
    }
  })
})

describe('createCiSource', () => {
  it('persists with access token in DB but returns public shape', async () => {
    const result = await createCiSource({
      name: 'new',
      url: 'http://x',
      accessToken: 'persisted',
      provider: 'github',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as unknown as { accessToken?: string }).accessToken).toBeUndefined()

    const [dbRow] = await db.select().from(ciSources).where(eq(ciSources.id, result.data.id))
    expect(dbRow.accessToken).toBe('persisted')
  })
})

describe('getCiSourceById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getCiSourceById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the source when found', async () => {
    const seed = await seedSource()
    const result = await getCiSourceById(seed.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('src1')
  })
})

describe('updateCiSource', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateCiSource(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const seed = await seedSource()
    const result = await updateCiSource(seed.id, { name: 'renamed' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('renamed')
  })
})

describe('deleteCiSource', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteCiSource(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes from DB', async () => {
    const seed = await seedSource()
    const result = await deleteCiSource(seed.id)
    expect(result.ok).toBe(true)
    const rows = await db.select().from(ciSources).where(eq(ciSources.id, seed.id))
    expect(rows.length).toBe(0)
  })
})

describe('listCiProjects', () => {
  it('returns 404 for unknown source', async () => {
    const result = await listCiProjects(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
    expect(mockedListProjects).not.toHaveBeenCalled()
  })

  it('returns CI lib result for valid source', async () => {
    const seed = await seedSource()
    const result = await listCiProjects(seed.id, 'q')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([{ id: '1', name: 'proj', path: 'org/proj' }])
    expect(mockedListProjects).toHaveBeenCalledTimes(1)
    const [src, search] = mockedListProjects.mock.calls[0]
    expect(src.url).toBe('https://gl.example.com')
    expect(src.accessToken).toBe('tok-secret')
    expect(search).toBe('q')
  })
})

describe('listCiBranches', () => {
  it('returns 404 for unknown source', async () => {
    const result = await listCiBranches(999_999, 'p')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns CI lib result for valid source', async () => {
    const seed = await seedSource()
    const result = await listCiBranches(seed.id, 'proj-id')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([{ name: 'main' }])
    expect(mockedListBranches).toHaveBeenCalledTimes(1)
  })
})

describe('listCiFiles', () => {
  it('returns 404 for unknown source', async () => {
    const result = await listCiFiles(999_999, 'p', 'main')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns files', async () => {
    const seed = await seedSource()
    const result = await listCiFiles(seed.id, 'proj-id', 'main', '')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(1)
    expect(mockedListFiles).toHaveBeenCalledTimes(1)
  })
})

describe('importCiVars', () => {
  it('returns 404 for unknown source', async () => {
    const result = await importCiVars(999_999, 'p', 'main', 'main.tf')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('calls getFileContent and parseTerraformVariables', async () => {
    const seed = await seedSource()
    const result = await importCiVars(seed.id, 'proj-id', 'main', 'main.tf')
    expect(result.ok).toBe(true)

    expect(mockedGetFileContent).toHaveBeenCalledTimes(1)
    expect(mockedParse).toHaveBeenCalledTimes(1)
    expect(mockedParse).toHaveBeenCalledWith('variable "region" { type = string }')

    if (result.ok) {
      expect(result.data).toEqual([
        { name: 'region', type: 'string', description: '', default: '' },
      ])
    }
  })
})
