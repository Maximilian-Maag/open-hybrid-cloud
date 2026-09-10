import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { appConfig, deploymentWindows, auditLog } from '@/lib/db/schema'
import { createUser } from '@/test/helpers'
import { getWindowSettings, replaceWindowSettings, asClock } from './deploymentWindowAdmin'
import { loadWindowPolicy } from '@/lib/services/windowPolicy'

/**
 * Root configuring when provisioning may run (#330).
 *
 * The arithmetic is tested next door without a database. What is only testable
 * here is that what root saves is what the policy then reads — the two halves
 * were built at different times and nothing else joins them up.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const root = async () => createUser({ role: 'root', email: `win-admin-${Math.random()}@test.dev` })

describe('getWindowSettings', () => {
  it('reports no windows and the configured zone on a fresh deployment', async () => {
    const settings = await getWindowSettings()
    expect(settings.ok).toBe(true)
    if (!settings.ok) return
    expect(settings.data.windows).toEqual([])
    expect(settings.data.timeZone).toBe('UTC')
  })

  // A list that reorders itself between saves reads as the portal having
  // changed something root did not change.
  it('returns the windows in clock order whatever order they were sent', async () => {
    const actor = await root()
    await replaceWindowSettings(
      {
        timeZone: 'Europe/Berlin',
        windows: [
          { startMinute: 13 * 60, durationMinutes: 90 },
          { startMinute: 8 * 60, durationMinutes: 120 },
        ],
      },
      actor.id,
    )

    const settings = await getWindowSettings()
    if (!settings.ok) throw new Error('expected the settings to load')
    expect(settings.data.windows.map((w) => w.startMinute)).toEqual([480, 780])
  })
})

describe('replaceWindowSettings', () => {
  it('saves what root defined and the policy reads it back', async () => {
    const actor = await root()

    const saved = await replaceWindowSettings(
      { timeZone: 'Europe/Berlin', windows: [{ startMinute: 8 * 60, durationMinutes: 120 }] },
      actor.id,
    )

    expect(saved.ok).toBe(true)
    // The join that nothing else asserts: the admin surface and the decision
    // path are separate modules over the same two tables.
    const policy = await loadWindowPolicy()
    expect(policy.timeZone).toBe('Europe/Berlin')
    expect(policy.windows).toEqual([{ startMinute: 480, durationMinutes: 120 }])
  })

  it('replaces the set rather than adding to it', async () => {
    const actor = await root()
    await replaceWindowSettings(
      { timeZone: 'UTC', windows: [{ startMinute: 60, durationMinutes: 60 }] },
      actor.id,
    )

    await replaceWindowSettings(
      { timeZone: 'UTC', windows: [{ startMinute: 600, durationMinutes: 60 }] },
      actor.id,
    )

    const rows = await db.select().from(deploymentWindows)
    expect(rows.map((r) => r.startMinute)).toEqual([600])
  })

  it('can clear every window, which turns the restriction off', async () => {
    const actor = await root()
    await replaceWindowSettings({ timeZone: 'UTC', windows: [{ startMinute: 60, durationMinutes: 60 }] }, actor.id)

    expect((await replaceWindowSettings({ timeZone: 'UTC', windows: [] }, actor.id)).ok).toBe(true)

    expect(await db.select().from(deploymentWindows)).toHaveLength(0)
  })

  /*
   * The whole set is validated together because an overlap is a property of the
   * collection: neither of these two windows is wrong on its own.
   */
  it('refuses an overlapping pair and writes nothing', async () => {
    const actor = await root()
    await replaceWindowSettings({ timeZone: 'UTC', windows: [{ startMinute: 480, durationMinutes: 60 }] }, actor.id)

    const result = await replaceWindowSettings(
      {
        timeZone: 'UTC',
        windows: [
          { startMinute: 480, durationMinutes: 120 },
          { startMinute: 540, durationMinutes: 60 },
        ],
      },
      actor.id,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('overlap')
    // The existing schedule survives a rejected save.
    const rows = await db.select().from(deploymentWindows)
    expect(rows.map((r) => r.durationMinutes)).toEqual([60])
  })

  it('refuses a window that runs past midnight', async () => {
    const actor = await root()
    const result = await replaceWindowSettings(
      { timeZone: 'UTC', windows: [{ startMinute: 23 * 60, durationMinutes: 120 }] },
      actor.id,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('midnight')
  })

  /*
   * Asked of Intl rather than matched against a pattern: "Europe/Berlin" and
   * "Mars/Olympus" are the same shape, and an unknown zone does not fail here —
   * it throws inside an approval, hours later, in front of somebody with no way
   * to connect the two.
   */
  it('refuses a zone the runtime does not know', async () => {
    const actor = await root()
    const result = await replaceWindowSettings({ timeZone: 'Mars/Olympus', windows: [] }, actor.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('Unknown time zone')
    const [config] = await db.select().from(appConfig).where(eq(appConfig.id, 1))
    expect(config.deploymentTimeZone).toBe('UTC')
  })

  // The audit log is the only record of who narrowed the window an order then
  // waited for, so it has to say so in the terms root thinks in.
  it('audits the change as clock times, not minute integers', async () => {
    const actor = await root()

    await replaceWindowSettings(
      { timeZone: 'Europe/Berlin', windows: [{ startMinute: 8 * 60 + 30, durationMinutes: 90 }] },
      actor.id,
    )

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'deployment_windows.updated'))
    expect(entry.details).toContain('08:30 for 90m')
    expect(entry.details).toContain('UTC → Europe/Berlin')
    expect(entry.userId).toBe(actor.id)
  })
})

describe('asClock', () => {
  it.each([
    [0, '00:00'],
    [9 * 60 + 5, '09:05'],
    [13 * 60 + 30, '13:30'],
    [1439, '23:59'],
  ])('renders minute %i as %s', (minute, expected) => {
    expect(asClock(minute)).toBe(expected)
  })
})
