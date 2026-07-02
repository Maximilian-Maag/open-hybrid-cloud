import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSmtpConfig,
  updateSmtpConfig,
  getAiConfig,
  updateAiConfig,
} from './config'
import { db } from '@/lib/db/client'
import { appConfig } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

// The app_config row with id=1 is seeded once in beforeAll, but the table is
// not in the TRUNCATE list — so the row persists across tests. Reset it here
// to keep tests isolated.
beforeEach(async () => {
  await db.execute(sql`
    UPDATE app_config SET
      smtp_host = NULL, smtp_port = NULL, smtp_from = NULL,
      smtp_user = NULL, smtp_pass = NULL, smtp_tls = TRUE,
      ai_provider = NULL, ai_endpoint = NULL, ai_api_key = NULL, ai_model = NULL
    WHERE id = 1
  `)
})

describe('getSmtpConfig', () => {
  it('returns empty defaults when nothing configured', async () => {
    const result = await getSmtpConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.host).toBe('')
      expect(result.data.port).toBe(587)
      expect(result.data.from).toBe('')
      expect(result.data.user).toBe('')
      expect(result.data.tls).toBe(true)
    }
  })

  it('does not expose the password field', async () => {
    await updateSmtpConfig({
      host: 'smtp.example.com',
      port: 587,
      from: 'noreply@example.com',
      password: 'super-secret',
    })
    const result = await getSmtpConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.data as unknown as { smtpPass?: string }).smtpPass).toBeUndefined()
      expect((result.data as unknown as { password?: string }).password).toBeUndefined()
    }
  })
})

describe('updateSmtpConfig', () => {
  it('persists to DB; getSmtpConfig reflects the change', async () => {
    await updateSmtpConfig({
      host: 'smtp.example.com',
      port: 25,
      from: 'no@example.com',
      user: 'u',
      password: 'p',
      tls: false,
    })

    const result = await getSmtpConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.host).toBe('smtp.example.com')
      expect(result.data.port).toBe(25)
      expect(result.data.from).toBe('no@example.com')
      expect(result.data.user).toBe('u')
      expect(result.data.tls).toBe(false)
    }
  })
})

describe('getAiConfig', () => {
  it('returns empty defaults when nothing configured', async () => {
    const result = await getAiConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.provider).toBe('claude')
      expect(result.data.endpoint).toBe('')
      expect(result.data.model).toBe('')
    }
  })

  it('does not expose the apiKey field', async () => {
    await updateAiConfig({
      provider: 'openai',
      endpoint: 'https://api',
      apiKey: 'sk-secret',
      model: 'gpt-4',
    })
    const result = await getAiConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.data as unknown as { aiApiKey?: string }).aiApiKey).toBeUndefined()
      expect((result.data as unknown as { apiKey?: string }).apiKey).toBeUndefined()
    }
  })
})

describe('updateAiConfig', () => {
  it('persists to DB; getAiConfig reflects the change', async () => {
    await updateAiConfig({
      provider: 'openai',
      endpoint: 'https://api.openai.com',
      apiKey: 'k',
      model: 'gpt-4o',
    })

    const result = await getAiConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.provider).toBe('openai')
      expect(result.data.endpoint).toBe('https://api.openai.com')
      expect(result.data.model).toBe('gpt-4o')
    }

    // Sanity check: DB row also has the apiKey persisted
    const rows = await db.select().from(appConfig)
    expect(rows[0]?.aiApiKey).toBe('k')
  })
})
