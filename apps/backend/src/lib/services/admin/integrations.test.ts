import { describe, it, expect, vi, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { testDb } from '@/test/setup'
import { createUser, createCiSource, createEnvironment } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { auditLog, integrations } from '@/lib/db/schema'
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
  getIntegrationById,
  listIntegrations,
  probeIntegrationById,
  resolveIntegration,
  blocksProvisioning,
  type CreateIntegrationInput,
} from './integrations'
import { SECRET_KEY_ENV, isEncryptedEnvelope } from '@/lib/crypto/secrets'

const configuredKey = process.env[SECRET_KEY_ENV]

afterEach(() => {
  vi.restoreAllMocks()
  if (configuredKey === undefined) delete process.env[SECRET_KEY_ENV]
  else process.env[SECRET_KEY_ENV] = configuredKey
})

const input = (overrides: Partial<CreateIntegrationInput> = {}): CreateIntegrationInput => ({
  kind: 'foreman',
  name: 'Foreman Prod',
  baseUrl: 'https://foreman.example.com',
  authType: 'bearer',
  credential: 'glpat-super-secret',
  failureMode: 'blocking',
  ...overrides,
})

const rootId = async () => (await createUser({ role: 'root' })).id

/** The credential column exactly as Postgres holds it. */
const rawCredential = async (id: number): Promise<string | null> => {
  const rows = await testDb.execute<{ credential: string | null }>(
    sql`SELECT credential FROM integrations WHERE id = ${id}`,
  )
  return (rows as unknown as { credential: string | null }[])[0].credential
}

const auditEntries = () => db.select().from(auditLog).orderBy(auditLog.id)

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createIntegration', () => {
  it('stores an integration and returns it without the credential', async () => {
    const actor = await rootId()
    const result = await createIntegration(actor, input())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({
      kind: 'foreman',
      name: 'Foreman Prod',
      baseUrl: 'https://foreman.example.com',
      authType: 'bearer',
      hasCredential: true,
      environmentId: null,
      enabled: true,
      failureMode: 'blocking',
      lastContactedAt: null,
      lastError: null,
    })
    expect(result.data).not.toHaveProperty('credential')
    expect(JSON.stringify(result.data)).not.toContain('glpat-super-secret')
  })

  it('is CIPHERTEXT that lands in the column, not the token', async () => {
    // The whole point of #111's second bullet. ci_sources.access_token holds the
    // token verbatim; a dump of this table must not.
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    const stored = await rawCredential(created.data.id)
    expect(stored).not.toBeNull()
    expect(stored).not.toBe('glpat-super-secret')
    expect(stored).not.toContain('glpat')
    expect(isEncryptedEnvelope(stored ?? '')).toBe(true)
  })

  it('stores nothing in the column for authType none', async () => {
    const actor = await rootId()
    const created = await createIntegration(
      actor,
      input({ kind: 'loki', authType: 'none', credential: undefined }),
    )
    if (!created.ok) throw new Error(JSON.stringify(created))

    expect(created.data.hasCredential).toBe(false)
    expect(await rawCredential(created.data.id)).toBeNull()
  })

  it('keeps the basic-auth username readable', async () => {
    // Not a secret, and the admin UI has to be able to say WHICH account is
    // configured without a decrypt round trip.
    const actor = await rootId()
    const created = await createIntegration(
      actor,
      input({ kind: 'nexus', authType: 'basic', username: 'svc-portal', credential: 'pw' }),
    )
    if (!created.ok) throw new Error(JSON.stringify(created))
    expect(created.data.username).toBe('svc-portal')
  })

  it('requires a credential unless authType is none', async () => {
    const actor = await rootId()
    const result = await createIntegration(actor, input({ credential: undefined }))
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('drops a credential sent alongside authType none rather than storing one nothing sends', async () => {
    const actor = await rootId()
    const created = await createIntegration(
      actor,
      input({ kind: 'loki', authType: 'none', credential: 'left-over-from-the-form' }),
    )
    if (!created.ok) throw new Error(JSON.stringify(created))
    expect(created.data.hasCredential).toBe(false)
    expect(await rawCredential(created.data.id)).toBeNull()
  })

  it('treats an empty credential as none supplied', async () => {
    const actor = await rootId()
    expect(await createIntegration(actor, input({ credential: '' }))).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('requires a username for basic auth', async () => {
    const actor = await rootId()
    const result = await createIntegration(actor, input({ authType: 'basic', username: '' }))
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('binds to an environment when asked', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const created = await createIntegration(actor, input({ environmentId: env.id }))
    if (!created.ok) throw new Error(JSON.stringify(created))
    expect(created.data.environmentId).toBe(env.id)
  })

  it('rejects an environment that does not exist with a 400, not a 500', async () => {
    const actor = await rootId()
    const result = await createIntegration(actor, input({ environmentId: 999_999 }))
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a second portal-wide integration of the same kind', async () => {
    // Two portal-wide Foremans would leave "which Foreman do we reconcile
    // against" (#112) unanswerable, and a plain UNIQUE (kind, environment_id)
    // would allow it, because Postgres treats NULLs as distinct.
    const actor = await rootId()
    await createIntegration(actor, input())
    const second = await createIntegration(actor, input({ name: 'Foreman Other' }))

    expect(second).toMatchObject({ ok: false, status: 409 })
    if (second.ok) return
    expect(second.message).toContain('portal-wide')
  })

  it('refuses a second integration of the same kind in one environment', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    await createIntegration(actor, input({ environmentId: env.id }))
    const second = await createIntegration(
      actor,
      input({ environmentId: env.id, name: 'Foreman Two' }),
    )
    expect(second).toMatchObject({ ok: false, status: 409 })
  })

  it('allows the same kind in two different environments, and portal-wide beside them', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const envA = await createEnvironment(ci.id, undefined, 'A')
    const envB = await createEnvironment(ci.id, undefined, 'B')

    expect((await createIntegration(actor, input({ environmentId: envA.id }))).ok).toBe(true)
    expect((await createIntegration(actor, input({ environmentId: envB.id }))).ok).toBe(true)
    expect((await createIntegration(actor, input({ environmentId: null }))).ok).toBe(true)
  })

  it('allows different kinds portal-wide', async () => {
    const actor = await rootId()
    expect((await createIntegration(actor, input({ kind: 'foreman' }))).ok).toBe(true)
    expect((await createIntegration(actor, input({ kind: 'grafana' }))).ok).toBe(true)
  })

  it('writes an audit entry naming what was created', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    const entries = await auditEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      userId: actor,
      action: 'integration.created',
      entityId: created.data.id,
    })
    expect(entries[0].details).toContain('Foreman Prod')
    expect(entries[0].details).toContain('blocking')
    // The audit log is exportable; it must not become the plaintext store.
    expect(entries[0].details).not.toContain('glpat-super-secret')
  })
})

describe('createIntegration without SECRET_ENCRYPTION_KEY', () => {
  it('refuses with a 503 naming the variable rather than storing plaintext', async () => {
    delete process.env[SECRET_KEY_ENV]
    const actor = await rootId()

    const result = await createIntegration(actor, input())
    expect(result).toMatchObject({ ok: false, status: 503 })
    if (result.ok) return
    expect(result.message).toContain(SECRET_KEY_ENV)

    // Nothing was written — not a row with a plaintext credential, not a row
    // with a null one that would look configured in the admin list.
    expect(await db.select().from(integrations)).toHaveLength(0)
    expect(await auditEntries()).toHaveLength(0)
  })

  it('still allows an integration that needs no credential', async () => {
    // A Loki with no auth is usable without the key, and refusing it would make
    // the whole registry hostage to a feature it does not need.
    delete process.env[SECRET_KEY_ENV]
    const actor = await rootId()

    const result = await createIntegration(
      actor,
      input({ kind: 'loki', authType: 'none', credential: undefined }),
    )
    expect(result.ok).toBe(true)
  })

  it('refuses when the key is present but malformed', async () => {
    process.env[SECRET_KEY_ENV] = 'not-64-hex'
    const actor = await rootId()

    const result = await createIntegration(actor, input())
    expect(result).toMatchObject({ ok: false, status: 503 })
    if (result.ok) return
    expect(result.message).toContain('hex characters')
  })
})

describe('updateIntegration', () => {
  it('changes fields and audits the diff', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateIntegration(actor, created.data.id, {
      name: 'Foreman Staging',
      failureMode: 'best_effort',
      enabled: false,
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.data).toMatchObject({
      name: 'Foreman Staging',
      failureMode: 'best_effort',
      enabled: false,
    })

    const entries = await auditEntries()
    const update = entries.find((e) => e.action === 'integration.updated')
    expect(update?.details).toContain('"Foreman Prod" → "Foreman Staging"')
    expect(update?.details).toContain('failureMode')
  })

  it('leaves the credential alone when the field is omitted', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')
    const before = await rawCredential(created.data.id)

    await updateIntegration(actor, created.data.id, { name: 'Renamed' })
    expect(await rawCredential(created.data.id)).toBe(before)
  })

  it('re-encrypts on rotation and audits it separately', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')
    const before = await rawCredential(created.data.id)

    const updated = await updateIntegration(actor, created.data.id, { credential: 'new-token' })
    expect(updated.ok).toBe(true)

    const after = await rawCredential(created.data.id)
    expect(after).not.toBe(before)
    expect(after).not.toContain('new-token')
    expect(isEncryptedEnvelope(after ?? '')).toBe(true)

    // Two entries: the update, and the rotation as a fact of its own. "When was
    // this token last changed" cannot be answered from an update diff that
    // deliberately does not mention the credential.
    const actions = (await auditEntries()).map((e) => e.action)
    expect(actions).toContain('integration.updated')
    expect(actions).toContain('integration.credential_rotated')
  })

  it('does not audit a rotation when the credential was not sent', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    await updateIntegration(actor, created.data.id, { enabled: false })
    const actions = (await auditEntries()).map((e) => e.action)
    expect(actions).not.toContain('integration.credential_rotated')
  })

  it('does not treat an empty credential as a rotation', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')
    const before = await rawCredential(created.data.id)

    await updateIntegration(actor, created.data.id, { credential: '' })
    expect(await rawCredential(created.data.id)).toBe(before)
    const actions = (await auditEntries()).map((e) => e.action)
    expect(actions).not.toContain('integration.credential_rotated')
  })

  it('a probe does not bump updatedAt', async () => {
    // updatedAt means "when was the configuration last changed". A health poller
    // running every minute would turn it into a copy of lastContactedAt and
    // destroy the only record of when somebody last touched the settings.
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ version: '3.9.1' }))
    await probeIntegrationById(created.data.id)

    const after = await getIntegrationById(created.data.id)
    expect(after.ok && after.data.updatedAt?.getTime()).toBe(created.data.updatedAt?.getTime())
  })

  it('clears the health record when the base URL changes', async () => {
    // The stored "last contacted" belonged to the old address; keeping it would
    // show a green integration that has never been reached where it now lives.
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ version: '3.9.1' }))
    await probeIntegrationById(created.data.id)
    const probed = await getIntegrationById(created.data.id)
    expect(probed.ok && probed.data.lastContactedAt).not.toBeNull()

    const updated = await updateIntegration(actor, created.data.id, {
      baseUrl: 'https://foreman-2.example.com',
    })
    expect(updated.ok && updated.data.lastContactedAt).toBeNull()
    expect(updated.ok && updated.data.lastError).toBeNull()
  })

  it('drops the stored credential when switching to authType none', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateIntegration(actor, created.data.id, { authType: 'none' })
    expect(updated.ok && updated.data.hasCredential).toBe(false)
    expect(await rawCredential(created.data.id)).toBeNull()
  })

  it('refuses to switch to an authenticated type with no credential stored', async () => {
    const actor = await rootId()
    const created = await createIntegration(
      actor,
      input({ kind: 'loki', authType: 'none', credential: undefined }),
    )
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateIntegration(actor, created.data.id, { authType: 'bearer' })
    expect(updated).toMatchObject({ ok: false, status: 400 })
  })

  it('accepts the switch when a credential comes with it', async () => {
    const actor = await rootId()
    const created = await createIntegration(
      actor,
      input({ kind: 'loki', authType: 'none', credential: undefined }),
    )
    if (!created.ok) throw new Error('setup failed')

    const updated = await updateIntegration(actor, created.data.id, {
      authType: 'bearer',
      credential: 'tok',
    })
    expect(updated.ok && updated.data.hasCredential).toBe(true)
  })

  it('refuses a rotation with no key configured', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')
    const before = await rawCredential(created.data.id)

    delete process.env[SECRET_KEY_ENV]
    const updated = await updateIntegration(actor, created.data.id, { credential: 'new' })
    expect(updated).toMatchObject({ ok: false, status: 503 })
    expect(await rawCredential(created.data.id)).toBe(before)
  })

  it('reports a 409 when the move would collide', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    await createIntegration(actor, input({ environmentId: env.id }))
    const global_ = await createIntegration(actor, input({ environmentId: null, name: 'Global' }))
    if (!global_.ok) throw new Error('setup failed')

    const moved = await updateIntegration(actor, global_.data.id, { environmentId: env.id })
    expect(moved).toMatchObject({ ok: false, status: 409 })
  })

  it('404s for an unknown id, without writing an audit entry', async () => {
    const actor = await rootId()
    expect(await updateIntegration(actor, 999_999, { enabled: false })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await auditEntries()).toHaveLength(0)
  })
})

describe('deleteIntegration', () => {
  it('deletes and audits what was deleted, not just its id', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    expect(await deleteIntegration(actor, created.data.id)).toMatchObject({ ok: true })
    expect(await db.select().from(integrations)).toHaveLength(0)

    const entry = (await auditEntries()).find((e) => e.action === 'integration.deleted')
    expect(entry?.entityId).toBe(created.data.id)
    // A trail of "deleted integration #7" is not a trail.
    expect(entry?.details).toContain('Foreman Prod')
    expect(entry?.details).toContain('https://foreman.example.com')
  })

  it('404s for an unknown id', async () => {
    const actor = await rootId()
    expect(await deleteIntegration(actor, 999_999)).toMatchObject({ ok: false, status: 404 })
  })

  it('goes away with its environment', async () => {
    // ON DELETE CASCADE, unlike the other references to deployment_environments:
    // deleteEnvironment() refuses on any non-cascading reference, so a plain FK
    // would make an environment undeletable once an integration was bound to it.
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await createIntegration(actor, input({ environmentId: env.id }))

    await testDb.execute(sql`DELETE FROM deployment_environments WHERE id = ${env.id}`)
    expect(await db.select().from(integrations)).toHaveLength(0)
  })
})

describe('listIntegrations', () => {
  it('never exposes the credential column', async () => {
    const actor = await rootId()
    await createIntegration(actor, input())

    const result = await listIntegrations()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.data)).not.toContain('glpat-super-secret')
    expect(JSON.stringify(result.data)).not.toContain('credential')
    expect(result.data[0].hasCredential).toBe(true)
  })

  it('orders by kind then name', async () => {
    const actor = await rootId()
    await createIntegration(actor, input({ kind: 'nexus', name: 'Nexus' }))
    await createIntegration(actor, input({ kind: 'ansible', name: 'AWX' }))

    const result = await listIntegrations()
    expect(result.ok && result.data.map((r) => r.kind)).toEqual(['ansible', 'nexus'])
  })
})

describe('probeIntegrationById', () => {
  it('records the contact time on success and clears any previous error', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('down', { status: 500 }))
    await probeIntegrationById(created.data.id)
    vi.restoreAllMocks()

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ version: '3.9.1', api_version: 2 }))
    const result = await probeIntegrationById(created.data.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ ok: true, status: 200, detail: 'Foreman 3.9.1, API v2' })
    expect(result.data.lastContactedAt).not.toBeNull()
    expect(result.data.lastError).toBeNull()
  })

  it('records the error on failure and keeps the last successful contact', async () => {
    // "Worked at T, broken since" — overwriting lastContactedAt on a failed
    // attempt would answer a different question.
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ version: '3.9.1' }))
    const good = await probeIntegrationById(created.data.id)
    const contactedAt = good.ok ? good.data.lastContactedAt : null
    expect(contactedAt).not.toBeNull()
    vi.restoreAllMocks()

    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
    const bad = await probeIntegrationById(created.data.id)

    expect(bad.ok).toBe(true)
    if (!bad.ok) return
    // A failed probe is a SUCCESSFUL answer to "does this work". Returning an
    // err here would make an unreachable Foreman indistinguishable from a bad
    // request at the HTTP layer.
    expect(bad.data.ok).toBe(false)
    expect(bad.data.error).toContain('credential')
    expect(bad.data.lastError).toContain('credential')
    expect(bad.data.lastContactedAt?.getTime()).toBe(contactedAt?.getTime())
  })

  it('sends the decrypted credential, never the envelope', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({}))
    await probeIntegrationById(created.data.id)

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const headers = (init.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer glpat-super-secret')
  })

  it('reports an undecryptable credential instead of throwing a 500', async () => {
    // The wrong-key case: a rotated or mistyped SECRET_ENCRYPTION_KEY. The
    // reason is recorded on the row, because the integration list is where the
    // operator will look next.
    const actor = await rootId()
    const created = await createIntegration(actor, input())
    if (!created.ok) throw new Error('setup failed')

    // Contact it successfully first: an earlier success must survive a later
    // failure, in the response as well as on the row.
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonRes({ version: '3.9.1' }))
    const good = await probeIntegrationById(created.data.id)
    const contactedAt = good.ok ? good.data.lastContactedAt : null
    expect(contactedAt).not.toBeNull()
    vi.restoreAllMocks()

    const fetchMock = vi.spyOn(global, 'fetch')
    process.env[SECRET_KEY_ENV] = 'f'.repeat(64)

    const result = await probeIntegrationById(created.data.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.ok).toBe(false)
    expect(result.data.error).toContain('could not be decrypted')
    expect(result.data.lastContactedAt?.getTime()).toBe(contactedAt?.getTime())
    expect(fetchMock).not.toHaveBeenCalled()

    process.env[SECRET_KEY_ENV] = configuredKey
    const row = await getIntegrationById(created.data.id)
    expect(row.ok && row.data.lastError).toContain('could not be decrypted')
  })

  it('404s for an unknown id', async () => {
    expect(await probeIntegrationById(999_999)).toMatchObject({ ok: false, status: 404 })
  })

  it('409s for a disabled integration', async () => {
    const actor = await rootId()
    const created = await createIntegration(actor, input({ enabled: false }))
    if (!created.ok) throw new Error('setup failed')

    expect(await probeIntegrationById(created.data.id)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('resolveIntegration', () => {
  it('prefers the environment-specific instance over the portal-wide one', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    await createIntegration(actor, input({ environmentId: null, name: 'Global Foreman' }))
    await createIntegration(actor, input({ environmentId: env.id, name: 'Env Foreman' }))

    const resolved = await resolveIntegration('foreman', env.id)
    expect(resolved?.name).toBe('Env Foreman')
  })

  it('falls back to the portal-wide instance', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await createIntegration(actor, input({ environmentId: null, name: 'Global Foreman' }))

    expect((await resolveIntegration('foreman', env.id))?.name).toBe('Global Foreman')
  })

  it('does not use an environment-specific instance for a different environment', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const envA = await createEnvironment(ci.id, undefined, 'A')
    const envB = await createEnvironment(ci.id, undefined, 'B')
    await createIntegration(actor, input({ environmentId: envA.id }))

    expect(await resolveIntegration('foreman', envB.id)).toBeNull()
  })

  it('only considers portal-wide rows when asked for no environment', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await createIntegration(actor, input({ environmentId: env.id }))

    expect(await resolveIntegration('foreman', null)).toBeNull()
  })

  it('hands back the decrypted credential and the failure mode', async () => {
    const actor = await rootId()
    await createIntegration(actor, input({ failureMode: 'blocking' }))

    const resolved = await resolveIntegration('foreman', null)
    expect(resolved).toMatchObject({
      credential: 'glpat-super-secret',
      failureMode: 'blocking',
      blocking: true,
    })
  })

  it('ignores a disabled instance', async () => {
    const actor = await rootId()
    await createIntegration(actor, input({ enabled: false }))
    expect(await resolveIntegration('foreman', null)).toBeNull()
  })

  it('falls back past a disabled environment-specific instance to the global one', async () => {
    const actor = await rootId()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await createIntegration(actor, input({ environmentId: env.id, enabled: false }))
    await createIntegration(actor, input({ environmentId: null, name: 'Global' }))

    expect((await resolveIntegration('foreman', env.id))?.name).toBe('Global')
  })

  it('returns null rather than throwing when the credential cannot be decrypted', async () => {
    const actor = await rootId()
    await createIntegration(actor, input())

    process.env[SECRET_KEY_ENV] = 'f'.repeat(64)
    expect(await resolveIntegration('foreman', null)).toBeNull()
  })

  it('returns null for a kind nothing is registered for', async () => {
    expect(await resolveIntegration('pulp', null)).toBeNull()
  })
})

describe('blocksProvisioning', () => {
  it('is true only for an enabled, blocking integration', () => {
    expect(blocksProvisioning({ enabled: true, failureMode: 'blocking' })).toBe(true)
    expect(blocksProvisioning({ enabled: true, failureMode: 'best_effort' })).toBe(false)
  })

  it('is false for a disabled integration whatever its failure mode', () => {
    // Switching one off says "carry on without it"; the opposite reading would
    // let one toggle stop all provisioning.
    expect(blocksProvisioning({ enabled: false, failureMode: 'blocking' })).toBe(false)
  })
})
