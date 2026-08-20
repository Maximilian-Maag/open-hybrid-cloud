import zlib from 'node:zlib'
import { db } from '@/lib/db/client'
import {
  categories,
  ciSources,
  costCenters,
  deploymentEnvironments,
  infrastructureElements,
  orders,
  parameters,
  productEnvironments,
  productTranslations,
  products,
  projects,
  users,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * A small, deterministic catalogue for a development database.
 *
 * The reason this exists: an empty database makes the portal impossible to look at
 * and, worse, quietly weakens what the test suites prove. Several e2e specs only
 * ever passed *because* nothing was there — `expect(links.or(empty)).toBeVisible()`
 * is a strict-mode violation as soon as a second product exists — and the axe gate
 * cannot see a contrast failure on a page whose content never renders. Issue #89.
 *
 * Idempotent: everything hangs off the marker category, and the whole thing is
 * skipped when that already exists. Nothing here touches a row it did not create,
 * so it is safe to run against a database that already has real data.
 */
const MARKER_CATEGORY = 'Demo — Compute'

/** A small PNG, generated rather than committed as a binary blob. */
const gradientPng = (hue: 'blue' | 'green' | 'amber'): Buffer => {
  const size = 160
  const tint = { blue: [40, 90, 200], green: [30, 160, 120], amber: [220, 150, 30] }[hue]
  const chunk = (tag: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body))
    return Buffer.concat([head, body, crc])
  }
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3 + 1)
    for (let x = 0; x < size; x++) {
      row[1 + x * 3] = Math.round((tint[0] * (x + 1)) / size)
      row[2 + x * 3] = Math.round((tint[1] * (y + 1)) / size)
      row[3 + x * 3] = tint[2]
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** CRC-32, for Node versions without zlib.crc32. */
const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface DemoProduct {
  name: string
  description: string
  germanName: string
  germanDescription: string
  image: 'blue' | 'green' | 'amber'
  imageAlt: string
  price: string
}

const CATALOGUE: DemoProduct[] = [
  {
    name: 'Managed Nginx Gateway',
    description:
      'A reverse proxy with TLS termination, WAF rules and per-project rate limiting. Provisioned into the environment you choose.',
    germanName: 'Managed Nginx Gateway',
    germanDescription:
      'Ein Reverse Proxy mit TLS-Terminierung, WAF-Regeln und projektbezogenem Rate Limiting.',
    image: 'blue',
    imageAlt: 'Abstract blue gradient standing in for a gateway product photo',
    price: '120.00',
  },
  {
    name: 'Postgres Cluster',
    description: 'A highly available Postgres cluster with automated backups and point-in-time recovery.',
    germanName: 'Postgres-Cluster',
    germanDescription: 'Ein hochverfügbarer Postgres-Cluster mit automatischen Backups.',
    image: 'green',
    imageAlt: 'Abstract green gradient standing in for a database product photo',
    price: '340.00',
  },
  {
    name: 'Kubernetes Cluster',
    description: 'A managed Kubernetes cluster with an autoscaling node pool and cluster-wide monitoring.',
    germanName: 'Kubernetes-Cluster',
    germanDescription: 'Ein gemanagter Kubernetes-Cluster mit automatisch skalierendem Node-Pool.',
    image: 'amber',
    imageAlt: 'Abstract amber gradient standing in for a Kubernetes product photo',
    price: '890.00',
  },
]

export const seedDemoData = async (): Promise<{ created: boolean }> => {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, MARKER_CATEGORY))
    .limit(1)

  if (existing.length > 0) {
    console.warn('[demo] Demo data already present — nothing to do.')
    return { created: false }
  }

  const [root] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'root')).limit(1)
  if (!root) {
    console.error('[demo] No root user yet. Run `make db-seed` first.')
    return { created: false }
  }

  const [category] = await db.insert(categories).values({ name: MARKER_CATEGORY }).returning()
  const [ci] = await db
    .insert(ciSources)
    .values({ name: 'Demo GitLab', url: 'https://gitlab.example.invalid', accessToken: 'demo-token', provider: 'gitlab' })
    .returning()

  const [frankfurt] = await db
    .insert(deploymentEnvironments)
    .values({
      name: 'AWS Frankfurt',
      description: 'Public cloud, eu-central-1',
      ciSourceId: ci.id,
      webhookUrl: 'https://gitlab.example.invalid/api/v4/projects/1/trigger/pipeline',
      webhookToken: 'demo-trigger-1',
      callbackSecret: 'demo-callback-1',
    })
    .returning()

  const [onPrem] = await db
    .insert(deploymentEnvironments)
    .values({
      name: 'On-Premise Vienna',
      description: 'vSphere cluster in the Vienna datacentre',
      ciSourceId: ci.id,
      webhookUrl: 'https://gitlab.example.invalid/api/v4/projects/2/trigger/pipeline',
      webhookToken: 'demo-trigger-2',
      callbackSecret: 'demo-callback-2',
    })
    .returning()

  const [platformCc] = await db
    .insert(costCenters)
    .values({ code: 'CC-100', name: 'Platform Operations' })
    .returning()
  await db.insert(costCenters).values({ code: 'CC-200', name: 'Data Services' })

  const [webshop] = await db
    .insert(projects)
    .values({ name: 'Webshop Platform', description: 'Customer-facing shop', ownerId: root.id, costCenterId: platformCc.id })
    .returning()

  const created: { id: number; name: string }[] = []
  for (const item of CATALOGUE) {
    const [product] = await db
      .insert(products)
      .values({
        categoryId: category.id,
        baseLanguage: 'en',
        image: gradientPng(item.image),
        imageMime: 'image/png',
        imageAlt: item.imageAlt,
      })
      .returning()

    await db.insert(productTranslations).values([
      { productId: product.id, languageCode: 'en', name: item.name, description: item.description },
      { productId: product.id, languageCode: 'de', name: item.germanName, description: item.germanDescription },
    ])

    // Two environments at different prices, so the cheapest-offer logic on the
    // product page and the per-environment breakdown in the cost report have
    // something to show.
    await db.insert(productEnvironments).values([
      { productId: product.id, environmentId: frankfurt.id, price: item.price, currency: 'EUR' },
      {
        productId: product.id,
        environmentId: onPrem.id,
        price: (Number(item.price) * 1.4).toFixed(2),
        currency: 'EUR',
      },
    ])

    created.push({ id: product.id, name: item.name })
  }

  // One sensitive parameter, because redaction in the export and on the detail
  // page is only exercised when one exists.
  await db.insert(parameters).values([
    {
      scope: 'product',
      scopeId: created[0].id,
      name: 'hostname',
      label: 'Hostname',
      type: 'string',
      description: 'DNS name for the gateway',
      required: true,
    },
    {
      scope: 'product',
      scopeId: created[0].id,
      name: 'admin_password',
      label: 'Admin password',
      type: 'string',
      description: 'Initial administrator password',
      required: true,
      sensitive: true,
    },
  ])

  // Orders across the states the UI renders differently: a completed one with
  // infrastructure, one still waiting for approval, and a failed deployment —
  // which is an ACTIVE element whose order failed, the case #29's Retry keys off.
  const [completed] = await db
    .insert(orders)
    .values({
      projectId: webshop.id,
      productId: created[0].id,
      environmentId: frankfurt.id,
      userId: root.id,
      status: 'completed',
      costCenterId: platformCc.id,
      parameters: { hostname: 'gateway-01', admin_password: 'demo-only' },
    })
    .returning()

  await db.insert(orders).values({
    projectId: webshop.id,
    productId: created[1].id,
    environmentId: onPrem.id,
    userId: root.id,
    status: 'pending',
    costCenterId: platformCc.id,
    parameters: {},
  })

  const [failed] = await db
    .insert(orders)
    .values({
      projectId: webshop.id,
      productId: created[2].id,
      environmentId: frankfurt.id,
      userId: root.id,
      status: 'failed',
      costCenterId: platformCc.id,
      parameters: {},
    })
    .returning()

  await db.insert(infrastructureElements).values([
    {
      orderId: completed.id,
      projectId: webshop.id,
      environmentId: frankfurt.id,
      productId: created[0].id,
      status: 'active',
      parameters: { hostname: 'gateway-01', admin_password: 'demo-only' },
      outputs: { ip_address: '203.0.113.10', hostname: 'gateway-01' },
      deployedAt: new Date(),
    },
    {
      orderId: failed.id,
      projectId: webshop.id,
      environmentId: frankfurt.id,
      productId: created[2].id,
      status: 'active',
      parameters: {},
      outputs: {},
      deployedAt: new Date(),
    },
  ])

  console.warn(
    `[demo] Created ${created.length} products, 2 environments, 1 project, 2 cost centres, 3 orders and 2 infrastructure elements.`,
  )
  return { created: true }
}
