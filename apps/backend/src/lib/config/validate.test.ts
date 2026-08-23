import { describe, it, expect, vi, afterEach } from 'vitest'
import { configProblems, reportConfigProblems, MIN_JWT_SECRET_LENGTH, type ConfigEnv } from './validate'

const validEnv = {
  JWT_SECRET: 'x'.repeat(MIN_JWT_SECRET_LENGTH),
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/db',
} satisfies ConfigEnv

afterEach(() => vi.restoreAllMocks())

describe('configProblems', () => {
  it('accepts a complete configuration', () => {
    expect(configProblems(validEnv)).toEqual([])
  })

  it('reports a JWT_SECRET that is too short, with its actual length', () => {
    // The shipped backend .env.example had a 23-character value, which fails
    // every login with an error that never leaves the server log.
    const problems = configProblems({ ...validEnv, JWT_SECRET: 'change-me-in-production' })
    expect(problems).toHaveLength(1)
    expect(problems[0].variable).toBe('JWT_SECRET')
    expect(problems[0].message).toContain('23 characters')
  })

  it('distinguishes an unset secret from a short one', () => {
    const problems = configProblems({ ...validEnv, JWT_SECRET: '' })
    expect(problems[0].message).toContain('not set')
  })

  it('accepts a secret of exactly the minimum length', () => {
    expect(configProblems({ ...validEnv, JWT_SECRET: 'a'.repeat(MIN_JWT_SECRET_LENGTH) })).toEqual([])
  })

  it('reports a missing DATABASE_URL', () => {
    const problems = configProblems({ ...validEnv, DATABASE_URL: '' })
    expect(problems.map((p) => p.variable)).toEqual(['DATABASE_URL'])
  })

  it('reports every problem at once rather than the first', () => {
    expect(configProblems({} satisfies ConfigEnv).map((p) => p.variable)).toEqual([
      'JWT_SECRET',
      'DATABASE_URL',
    ])
  })

  describe('SECRET_ENCRYPTION_KEY (issue #111)', () => {
    const key = 'a'.repeat(64)

    it('says nothing when it is absent', () => {
      // Absence disables the integration registry; it is not a misconfiguration.
      // Warning about it on every boot of every deployment that does not use
      // integrations is the noise that trains people to ignore this block.
      expect(configProblems(validEnv)).toEqual([])
    })

    it('says nothing when it is a valid key', () => {
      expect(configProblems({ ...validEnv, SECRET_ENCRYPTION_KEY: key })).toEqual([])
    })

    it('reports a key that is set but the wrong length', () => {
      const problems = configProblems({ ...validEnv, SECRET_ENCRYPTION_KEY: 'a'.repeat(32) })
      expect(problems.map((p) => p.variable)).toEqual(['SECRET_ENCRYPTION_KEY'])
      expect(problems[0].message).toContain('64 hex characters')
    })

    it('reports a key that is the right length but not hex', () => {
      // A base64 key is the likely mistake — 44 characters, or 64 if someone
      // pads it — and it would otherwise be accepted as bytes it is not.
      const problems = configProblems({ ...validEnv, SECRET_ENCRYPTION_KEY: 'z'.repeat(64) })
      expect(problems.map((p) => p.variable)).toEqual(['SECRET_ENCRYPTION_KEY'])
    })

    it('warns that a changed key cannot decrypt existing credentials', () => {
      const problems = configProblems({ ...validEnv, SECRET_ENCRYPTION_KEY: 'nope' })
      expect(problems[0].message).toContain('cannot')
    })
  })
})

describe('reportConfigProblems', () => {
  it('writes each problem to stderr and returns them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const problems = reportConfigProblems({ ...validEnv, JWT_SECRET: 'too-short' })

    expect(problems).toHaveLength(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[config] JWT_SECRET'))
  })

  it('says nothing when the configuration is fine', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportConfigProblems(validEnv)
    expect(spy).not.toHaveBeenCalled()
  })
})
