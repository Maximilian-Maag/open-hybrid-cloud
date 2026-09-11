import { describe, it, expect, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'
import { createCategory, createProduct, createCiSource, createEnvironment, linkProductEnvironment, createProject, createUser, createOrder } from '@/test/helpers'
import type { ProductSnapshot } from './snapshot'
import {
  REDACTED,
  loadSensitiveParameterNames,
  loadSnapshotSensitiveNames,
  redactParameters,
  redactParametersForOrders,
  union,
  withoutSensitiveDefaults,
} from './parameterRedaction'

/**
 * What this module decides is whether a stored secret is shown to somebody
 * (#131), so every case below is written against a way of getting that wrong
 * rather than against a line of code.
 */

const defineParameter = async (name: string, sensitive: boolean) => {
  await db.insert(parameters).values({ scope: 'global', scopeId: 0, name, label: name, type: 'string', sensitive })
}

const snapshotWith = (names: { name: string; sensitive: boolean }[]): ProductSnapshot =>
  ({
    version: 1,
    capturedAt: new Date().toISOString(),
    productName: 'p',
    productDescription: '',
    environmentName: 'e',
    price: '1.00',
    currency: 'EUR',
    costCenterMode: 'project',
    forcedCostCenter: false,
    trialEnabled: false,
    trialDurationMinutes: 0,
    parameters: names.map((n) => ({
      name: n.name, label: n.name, type: 'text', description: '', defaultValue: '', required: false, sensitive: n.sensitive,
    })),
  }) as ProductSnapshot

describe('union — over-redacting is the safe direction', () => {
  it('keeps the catalogue answer when an order contributes none', () => {
    // Returning `b` (or an empty set) here would un-redact everything for an
    // order that predates snapshots.
    expect([...union(new Set(['token']), undefined)]).toEqual(['token'])
  })

  it('takes names from BOTH sides, not whichever is longer', () => {
    expect([...union(new Set(['a']), new Set(['b']))].sort()).toEqual(['a', 'b'])
  })

  it('leaves the caller sets alone', () => {
    const catalogue = new Set(['a'])
    union(catalogue, new Set(['b']))
    expect([...catalogue]).toEqual(['a'])
  })
})

describe('redactParameters', () => {
  it('replaces a sensitive value and keeps the key visible', () => {
    // The key has to survive: the export and the detail page both show WHICH
    // parameters an order carried, and only the value is the secret.
    expect(redactParameters({ token: 'hunter2', host: 'db1' }, new Set(['token'])))
      .toEqual({ token: REDACTED, host: 'db1' })
  })

  it('leaves everything alone when nothing is sensitive', () => {
    expect(redactParameters({ host: 'db1' }, new Set())).toEqual({ host: 'db1' })
  })

  it('survives an order with no stored parameters at all', () => {
    // `values ?? {}` — an order placed before the column was populated would
    // otherwise throw inside a list read and take the whole page with it.
    expect(redactParameters(undefined as never, new Set(['token']))).toEqual({})
  })

  it('does not invent a key that was never stored', () => {
    expect(redactParameters({}, new Set(['token']))).toEqual({})
  })
})

describe('withoutSensitiveDefaults', () => {
  it('blanks a sensitive default', () => {
    // #131: `GET /api/catalog/{id}` is `requireAuth` only, so a stored default
    // — often a placeholder credential — was readable by every signed-in user.
    const [def] = withoutSensitiveDefaults([{ sensitive: true, defaultValue: 'p4ssw0rd' }])
    expect(def.defaultValue).toBe('')
  })

  it('blanks to empty rather than to the sentinel', () => {
    // Deliberate, and load-bearing: this shape feeds a form control that is
    // posted back at checkout, so a sentinel would be STORED as the value.
    const [def] = withoutSensitiveDefaults([{ sensitive: true, defaultValue: 'p4ssw0rd' }])
    expect(def.defaultValue).not.toBe(REDACTED)
  })

  it('leaves a non-sensitive default intact', () => {
    // Over-blanking costs the order form every prefilled value it has.
    const [def] = withoutSensitiveDefaults([{ sensitive: false, defaultValue: 'eu-central-1' }])
    expect(def.defaultValue).toBe('eu-central-1')
  })

  it('does not mutate the definition it was given', () => {
    // These come from a cached catalogue read; editing in place would blank the
    // default for every later caller too.
    const defs = [{ sensitive: true, defaultValue: 'p4ssw0rd' }]
    withoutSensitiveDefaults(defs)
    expect(defs[0].defaultValue).toBe('p4ssw0rd')
  })
})

describe('loadSensitiveParameterNames', () => {
  it('returns the flagged names and not the others', async () => {
    await defineParameter('api_token', true)
    await defineParameter('region', false)
    const names = await loadSensitiveParameterNames()
    expect(names.has('api_token')).toBe(true)
    expect(names.has('region')).toBe(false)
  })
})

describe('loadSnapshotSensitiveNames', () => {
  const orderWithSnapshot = async (snapshot: ProductSnapshot | undefined) => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const user = await createUser()
    const project = await createProject(user.id)
    return createOrder(project.id, product.id, env.id, user.id, snapshot ? { productSnapshot: snapshot } : undefined)
  }

  it('asks nothing when there are no orders to ask about', async () => {
    // Asserted on the QUERY, not just the answer: every list read with no
    // orders on the page would otherwise pay for an `IN ()` round trip, and a
    // test that only checks the empty result passes either way.
    const select = vi.spyOn(db, 'select')
    try {
      expect((await loadSnapshotSensitiveNames([])).size).toBe(0)
      expect(select).not.toHaveBeenCalled()
    } finally {
      select.mockRestore()
    }
  })

  it('reports only the names the snapshot flagged', async () => {
    const order = await orderWithSnapshot(snapshotWith([
      { name: 'api_token', sensitive: true },
      { name: 'region', sensitive: false },
    ]))
    const byOrder = await loadSnapshotSensitiveNames([order.id])
    expect([...(byOrder.get(order.id) ?? [])]).toEqual(['api_token'])
  })

  it('contributes nothing for an order that predates snapshots', async () => {
    const order = await orderWithSnapshot(undefined)
    expect((await loadSnapshotSensitiveNames([order.id])).has(order.id)).toBe(false)
  })

  it('does not record an order whose snapshot flagged nothing', async () => {
    // An empty set here would read as "this order has an answer", and the
    // union would then skip the catalogue's.
    const order = await orderWithSnapshot(snapshotWith([{ name: 'region', sensitive: false }]))
    expect((await loadSnapshotSensitiveNames([order.id])).has(order.id)).toBe(false)
  })
})

describe('redactParametersForOrders', () => {
  const placedOrder = async (snapshot?: ProductSnapshot) => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const user = await createUser()
    const project = await createProject(user.id)
    return createOrder(project.id, product.id, env.id, user.id, snapshot ? { productSnapshot: snapshot } : undefined)
  }

  it('returns an empty batch without touching the database', async () => {
    const rows: { parameters: Record<string, string> }[] = []
    expect(await redactParametersForOrders(rows, () => null)).toBe(rows)
  })

  it('redacts by the live catalogue when the row has no order', async () => {
    await defineParameter('api_token', true)
    const [row] = await redactParametersForOrders(
      [{ parameters: { api_token: 'hunter2', region: 'eu' } }],
      () => null,
    )
    expect(row.parameters).toEqual({ api_token: REDACTED, region: 'eu' })
  })

  /*
   * The property the whole module exists for (#131): a definition edited or
   * deleted after the order was placed must not un-flag the value it was
   * placed with. Dropping the union — or preferring one source over the other
   * — reads the secret out in the export.
   */
  it('still redacts a value whose definition has since been deleted', async () => {
    const order = await placedOrder(snapshotWith([{ name: 'legacy_secret', sensitive: true }]))
    // Nothing in the catalogue says `legacy_secret` is sensitive any more.
    const [row] = await redactParametersForOrders(
      [{ parameters: { legacy_secret: 'hunter2' } }],
      () => order.id,
    )
    expect(row.parameters.legacy_secret).toBe(REDACTED)
  })

  it('redacts the catalogue names too, not only the snapshot ones', async () => {
    await defineParameter('api_token', true)
    const order = await placedOrder(snapshotWith([{ name: 'legacy_secret', sensitive: true }]))
    const [row] = await redactParametersForOrders(
      [{ parameters: { api_token: 'a', legacy_secret: 'b', region: 'eu' } }],
      () => order.id,
    )
    expect(row.parameters).toEqual({ api_token: REDACTED, legacy_secret: REDACTED, region: 'eu' })
  })

  /*
   * A page of orders is not all one shape: the infrastructure list carries
   * rows that belong to an order beside rows that never did. Each has to be
   * redacted by the source that applies to it, in one pass.
   */
  it('redacts a mixed batch by the right source for each row', async () => {
    await defineParameter('api_token', true)
    const order = await placedOrder(snapshotWith([{ name: 'legacy_secret', sensitive: true }]))

    const rows: { tag: string; parameters: Record<string, string> }[] = [
      { tag: 'with-order', parameters: { legacy_secret: 'a', region: 'eu' } },
      { tag: 'no-order', parameters: { api_token: 'b', region: 'eu' } },
    ]
    const out = await redactParametersForOrders(rows, (r) => (r.tag === 'with-order' ? order.id : null))

    expect(out[0].parameters).toEqual({ legacy_secret: REDACTED, region: 'eu' })
    expect(out[1].parameters).toEqual({ api_token: REDACTED, region: 'eu' })
  })

  it('keeps every other field on the row', async () => {
    await defineParameter('api_token', true)
    const [row] = await redactParametersForOrders(
      [{ id: 9, parameters: { api_token: 'x' } }],
      () => null,
    )
    expect(row.id).toBe(9)
  })
})
