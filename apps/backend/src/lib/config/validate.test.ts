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
