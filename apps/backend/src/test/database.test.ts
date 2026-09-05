import { describe, it, expect } from 'vitest'
import { testDatabaseName, testDatabaseUrl } from './database'

describe('testDatabaseName', () => {
  it('gives two working directories two different databases', () => {
    // The collision this exists to prevent: a Stryker sandbox and the checkout it
    // was copied from, running the same suite at the same time.
    const a = testDatabaseName({}, '/repo/apps/backend')
    const b = testDatabaseName({}, '/repo/apps/backend/.stryker-tmp/sandbox-abc123')
    expect(a).not.toBe(b)
  })

  it('is stable for the same directory, so a rerun reuses its schema', () => {
    expect(testDatabaseName({}, '/repo/apps/backend')).toBe(testDatabaseName({}, '/repo/apps/backend'))
  })

  it('honours an explicit suffix for two runs in one checkout', () => {
    expect(testDatabaseName({ TEST_DB_SUFFIX: 'session-a' }, '/repo')).toBe('open_hybrid_cloud_test_session_a')
  })

  it('sanitises a suffix down to a safe identifier', () => {
    const name = testDatabaseName({ TEST_DB_SUFFIX: 'Feature/ABC-123; DROP' }, '/repo')
    expect(name).toMatch(/^open_hybrid_cloud_test_[a-z0-9_]+$/)
  })

  it('keeps the name inside Postgres\' 63-byte identifier limit', () => {
    const name = testDatabaseName({ TEST_DB_SUFFIX: 'x'.repeat(200) }, '/repo')
    expect(name.length).toBeLessThanOrEqual(63)
  })
})

describe('testDatabaseUrl', () => {
  it('keeps host, port and credentials and replaces only the database', () => {
    const url = testDatabaseUrl(
      { TEST_DATABASE_URL: 'postgresql://user:pw@db.example.org:6543/postgres', TEST_DB_SUFFIX: 'ci' },
      '/repo',
    )
    expect(url).toBe('postgresql://user:pw@db.example.org:6543/open_hybrid_cloud_test_ci')
  })

  it('defaults to the local dev Postgres', () => {
    expect(testDatabaseUrl({ TEST_DB_SUFFIX: 'x' }, '/repo')).toContain('localhost:5432')
  })
})
