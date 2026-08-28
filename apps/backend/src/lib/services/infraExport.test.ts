import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { EXPORT_MAX_ROWS } from './page'

vi.mock('@/lib/services/infrastructure', () => ({ listInfrastructure: vi.fn() }))
vi.mock('@/lib/services/infraCostCenters', () => ({ getCostCentersForInfra: vi.fn(async () => new Map()) }))

const { listInfrastructure } = await import('@/lib/services/infrastructure')
const { buildInfraExportRows } = await import('./infraExport')

const mocked = vi.mocked(listInfrastructure)

const session = { id: 1, role: 'admin', email: 'a@test.dev', name: 'Admin' } as SessionUser

const element = (id: number) => ({
  id,
  orderId: id,
  projectId: 1,
  environmentId: 1,
  productId: 1,
  status: 'active',
  parameters: {},
  pipelineId: [],
  outputs: {},
  deployedAt: new Date('2026-01-01T00:00:00Z'),
  scheduledDecommissionAt: null,
  sizeCode: null,
  sequence: 1,
  orderQuantity: 1,
  productName: 'VM',
  environmentName: 'prod',
  projectName: 'Platform',
  orderStatus: 'completed',
})

const page = (items: unknown[], total: number) => ({
  ok: true as const,
  data: { items, total, limit: EXPORT_MAX_ROWS, offset: 0 },
})

beforeEach(() => mocked.mockReset())

describe('buildInfraExportRows — the export is bounded too (#158)', () => {
  /*
   * The export legitimately wants more than a screenful, so it is not held to
   * the list's ceiling. It is still held to A ceiling: an unbounded read is an
   * unbounded read whether a person clicked "download" or not, and this one
   * builds the whole array in memory before it writes a byte.
   */
  it('asks for one window, as wide as an export is allowed to be', async () => {
    mocked.mockResolvedValue(page([element(1)], 1) as never)

    await buildInfraExportRows(session, { projectId: 4 })

    const [, filters, , maxLimit] = mocked.mock.calls[0]
    expect(filters.limit).toBe(EXPORT_MAX_ROWS)
    expect(filters.offset).toBe(0)
    // Passed as the ceiling as well, or `pageWindow` would clamp the export's
    // own limit back down to the list's.
    expect(maxLimit).toBe(EXPORT_MAX_ROWS)
    // The caller's filters survive: an export that applied different filters
    // than the list it was taken from is worse than no export.
    expect(filters.projectId).toBe(4)
  })

  /*
   * Refused rather than truncated, the way the audit export already does it. A
   * file that quietly stops at ten thousand rows looks like a complete
   * inventory, and an operator reconciling chargeback against it would find
   * nothing wrong with it.
   */
  it('refuses a selection larger than one export can carry', async () => {
    mocked.mockResolvedValue(page([element(1)], EXPORT_MAX_ROWS + 1) as never)

    const result = await buildInfraExportRows(session, {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(413)
      // Says what to do about it, not just that it failed.
      expect(result.message).toMatch(/narrow it/i)
    }
  })

  it('exports a selection that is exactly at the ceiling', async () => {
    mocked.mockResolvedValue(page([element(1)], EXPORT_MAX_ROWS) as never)

    const result = await buildInfraExportRows(session, {})

    expect(result.ok).toBe(true)
  })

  it('passes a failure from the list straight through', async () => {
    mocked.mockResolvedValue({ ok: false, status: 400, message: 'Invalid status' } as never)

    const result = await buildInfraExportRows(session, {})

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})
