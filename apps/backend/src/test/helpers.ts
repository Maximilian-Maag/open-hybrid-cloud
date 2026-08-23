import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { createSession } from '@/lib/auth/sessions'
import { generateTotpSecret, totp } from '@/lib/auth/totp'
import { encryptTotpSecret } from '@/lib/auth/totpSecret'
import { sql } from 'drizzle-orm'
import type { Role } from '@open-hybrid-cloud/types'

export const createUser = async (overrides?: {
  email?: string
  name?: string
  role?: Role
  active?: boolean
  password?: string
}) => {
  const password = overrides?.password ?? 'password123'
  const passwordHash = await bcrypt.hash(password, 4)
  const email = overrides?.email ?? `user-${Math.random().toString(36).slice(2)}@test.dev`

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      name: overrides?.name ?? 'Test User',
      role: overrides?.role ?? 'project_manager',
      active: overrides?.active ?? true,
      passwordHash,
    })
    .returning()

  return user
}

export const createCategory = async (name = 'Test Category') => {
  const [cat] = await db.insert(schema.categories).values({ name }).returning()
  return cat
}

export const createProduct = async (categoryId: number, name = 'Test Product') => {
  const [product] = await db
    .insert(schema.products)
    .values({ categoryId, baseLanguage: 'en' })
    .returning()

  await db
    .insert(schema.productTranslations)
    .values({ productId: product.id, languageCode: 'en', name, description: '' })

  return product
}

export const createCiSource = async (overrides?: { name?: string; url?: string }) => {
  const [src] = await db
    .insert(schema.ciSources)
    .values({
      name: overrides?.name ?? 'Test GitLab',
      url: overrides?.url ?? 'https://gitlab.example.com',
      accessToken: 'test-token',
      provider: 'gitlab',
    })
    .returning()
  return src
}

let envSeq = 0

export const createEnvironment = async (ciSourceId: number, webhookToken?: string, name?: string) => {
  // Default to a per-call unique token: callback_secret mirrors it (see below)
  // and is UNIQUE since migration 0006, so a shared default would collide for
  // any test that seeds more than one environment.
  const token = webhookToken ?? `wh-secret-${++envSeq}`
  const [env] = await db
    .insert(schema.deploymentEnvironments)
    .values({
      name: name ?? 'Test Env',
      ciSourceId,
      webhookUrl: 'https://gitlab.example.com/api/v4/projects/1/trigger/pipeline',
      webhookToken: token,
      // Mirror the migration 0004 backfill: legacy envs get callback_secret =
      // webhook_token. Tests that seed with a specific webhookToken and then
      // POST to /api/webhooks/gitlab/pipeline with that same value continue
      // to pass without special handling.
      callbackSecret: token,
    })
    .returning()
  return env
}

export const linkProductEnvironment = async (
  productId: number,
  environmentId: number,
  overrides?: {
    price?: string
    currency?: string
    costCenterMode?: 'project' | 'select' | 'overhead'
    forcedCostCenter?: boolean
    overheadCostCenterId?: number | null
    trialEnabled?: boolean
    trialDurationMinutes?: number
  },
) => {
  const [row] = await db
    .insert(schema.productEnvironments)
    .values({
      productId,
      environmentId,
      price: overrides?.price ?? '0',
      currency: overrides?.currency ?? 'EUR',
      ...(overrides?.costCenterMode ? { costCenterMode: overrides.costCenterMode } : {}),
      ...(overrides?.forcedCostCenter !== undefined ? { forcedCostCenter: overrides.forcedCostCenter } : {}),
      ...(overrides?.overheadCostCenterId !== undefined ? { overheadCostCenterId: overrides.overheadCostCenterId } : {}),
      ...(overrides?.trialEnabled !== undefined ? { trialEnabled: overrides.trialEnabled } : {}),
      ...(overrides?.trialDurationMinutes !== undefined ? { trialDurationMinutes: overrides.trialDurationMinutes } : {}),
    })
    .onConflictDoNothing()
    .returning()
  return row
}

/**
 * Add one size to an offering (issue #98).
 *
 * Note what this does to the offering it is added to: once it has ANY size, an
 * order against it must name one, and its price comes from the size rather than
 * from `product_environments.price`.
 */
export const createSize = async (
  productId: number,
  environmentId: number,
  overrides?: {
    code?: string
    label?: string
    price?: string
    currency?: string
    sortOrder?: number
    active?: boolean
  },
) => {
  const [row] = await db
    .insert(schema.productEnvironmentSizes)
    .values({
      productId,
      environmentId,
      code: overrides?.code ?? 'M',
      label: overrides?.label ?? 'Medium',
      price: overrides?.price ?? '10.00',
      currency: overrides?.currency ?? 'EUR',
      sortOrder: overrides?.sortOrder ?? 0,
      active: overrides?.active ?? true,
    })
    .returning()
  return row
}

export const createProject = async (ownerId: number, name?: string) => {
  const [project] = await db
    .insert(schema.projects)
    .values({ name: name ?? 'Test Project', ownerId })
    .returning()
  return project
}

export const createOrder = async (
  projectId: number,
  productId: number,
  environmentId: number,
  userId: number,
  overrides?: {
    status?: string
    pipelineId?: string[]
    isTrial?: boolean
    sizeCode?: string | null
    quantity?: number
    productSnapshot?: schema.Order['productSnapshot']
  },
) => {
  const [order] = await db
    .insert(schema.orders)
    .values({
      projectId,
      productId,
      environmentId,
      userId,
      status: (overrides?.status ?? 'pending') as schema.Order['status'],
      pipelineId: overrides?.pipelineId ?? [],
      ...(overrides?.isTrial !== undefined ? { isTrial: overrides.isTrial } : {}),
      ...(overrides?.sizeCode !== undefined ? { sizeCode: overrides.sizeCode } : {}),
      ...(overrides?.quantity !== undefined ? { quantity: overrides.quantity } : {}),
      ...(overrides?.productSnapshot !== undefined ? { productSnapshot: overrides.productSnapshot } : {}),
    })
    .returning()
  return order
}

export const createInfraElement = async (
  orderId: number,
  projectId: number,
  environmentId: number,
  productId: number,
  overrides?: {
    status?: string
    pipelineId?: string[]
    pipelineStatus?: Record<string, string>
    parameters?: Record<string, string>
    deployedAt?: Date
    sizeCode?: string | null
    sequence?: number
  },
) => {
  const [el] = await db
    .insert(schema.infrastructureElements)
    .values({
      orderId,
      projectId,
      environmentId,
      productId,
      status: (overrides?.status ?? 'active') as schema.InfrastructureElement['status'],
      pipelineId: overrides?.pipelineId ?? [],
      pipelineStatus: overrides?.pipelineStatus ?? {},
      ...(overrides?.sizeCode !== undefined ? { sizeCode: overrides.sizeCode } : {}),
      ...(overrides?.sequence !== undefined ? { sequence: overrides.sequence } : {}),
      ...(overrides?.parameters ? { parameters: overrides.parameters } : {}),
      ...(overrides?.deployedAt ? { deployedAt: overrides.deployedAt } : {}),
    })
    .returning()
  return el
}

/**
 * Seed an approval delegation directly (issue #35).
 *
 * Dates are offsets in DAYS from today so a fixture reads as "in force now" or
 * "already over" rather than as literal dates that would silently start failing
 * the moment they went past. Bypasses `createDelegation` on purpose: the service
 * refuses backdated and chained delegations, and a test for expiry needs exactly
 * those.
 */
export const createDelegation = async (
  fromUserId: number,
  toUserId: number,
  overrides?: { startsInDays?: number; endsInDays?: number; revokedAt?: Date },
) => {
  const day = (offset: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const [row] = await db
    .insert(schema.approvalDelegations)
    .values({
      fromUserId,
      toUserId,
      startsOn: day(overrides?.startsInDays ?? 0),
      endsOn: day(overrides?.endsInDays ?? 0),
      ...(overrides?.revokedAt ? { revokedAt: overrides.revokedAt } : {}),
    })
    .returning()
  return row
}

/**
 * Give a user a confirmed TOTP factor and return the raw secret, so a test can
 * generate the codes an authenticator app would show.
 *
 * Deliberately goes through the same encryption helper the service uses rather
 * than writing a secret straight into the column: a test that set up a plaintext
 * secret would pass while the production path was broken.
 */
export const enrollTotp = async (
  userId: number,
  overrides?: { confirmed?: boolean; recoveryCodes?: string[] },
): Promise<Buffer> => {
  const secret = generateTotpSecret()
  const envelope = encryptTotpSecret(secret, userId)
  const confirmed = overrides?.confirmed ?? true

  await db
    .insert(schema.userTotp)
    .values(
      confirmed
        ? { userId, secret: envelope, confirmedAt: new Date() }
        : { userId, pendingSecret: envelope, pendingCreatedAt: new Date() },
    )
    .onConflictDoUpdate({
      target: schema.userTotp.userId,
      set: confirmed
        ? { secret: envelope, confirmedAt: new Date(), pendingSecret: null, pendingCreatedAt: null }
        : { pendingSecret: envelope, pendingCreatedAt: new Date() },
    })

  if (overrides?.recoveryCodes?.length) {
    await db.insert(schema.userRecoveryCodes).values(
      overrides.recoveryCodes.map((code) => ({
        userId,
        codeHash: createHash('sha256')
          .update(code.toUpperCase().replace(/[^A-Z0-9]/g, ''), 'utf8')
          .digest('hex'),
      })),
    )
  }

  return secret
}

/** The code an authenticator app would be showing right now for `secret`. */
export const currentTotpCode = (secret: Buffer, offsetSteps = 0): string =>
  totp(secret, Math.floor(Date.now() / 1000) + offsetSteps * 30)

interface SessionOverrides {
  ip?: string | null
  userAgent?: string | null
  rememberMe?: boolean
}

/**
 * A real session for this user: the row, the token, and the header.
 *
 * Since #37 a token without a live `sessions` row is refused by every
 * authenticated request, so every authenticated test now goes through here —
 * which is also what makes the suite an honest test of that check rather than a
 * test of the signature alone.
 */
export const makeSession = async (
  user: schema.User,
  overrides?: SessionOverrides,
): Promise<{ auth: string; token: string; sessionId: number; expiresAt: Date }> => {
  const created = await createSession({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    },
    ip: overrides?.ip ?? '203.0.113.7',
    userAgent: overrides?.userAgent ?? 'vitest',
    rememberMe: overrides?.rememberMe,
  })
  return { auth: `Bearer ${created.token}`, ...created }
}

/** Just the header, for the many tests that never look at the row. */
export const makeAuthHeader = async (
  user: schema.User,
  overrides?: SessionOverrides,
): Promise<string> => (await makeSession(user, overrides)).auth

let ccSeq = 0

export const createCostCenter = async (overrides?: { code?: string; name?: string; active?: boolean }) => {
  const [cc] = await db
    .insert(schema.costCenters)
    .values({
      code: overrides?.code ?? `CC-${++ccSeq}`,
      name: overrides?.name ?? 'Test Cost Center',
      active: overrides?.active ?? true,
    })
    .returning()
  return cc
}

/**
 * Resolves once some statement in this test's database is waiting on a lock, and
 * reports whether one ever was.
 *
 * The race tests need to know that the contender has actually reached the write
 * it is supposed to contend on — that is the only moment at which the holder can
 * make the interleaving happen on purpose. Polling for the blocked lock is what
 * makes them deterministic rather than a coin flip on two concurrent promises.
 *
 * Scoped through pg_stat_activity rather than pg_locks.database: a statement
 * waiting for a row lock waits on the HOLDER'S transaction id, and for that lock
 * type the database column is NULL, so filtering on it finds nothing. Each run has
 * its own database (see test/database.ts), so datname is the honest scope.
 */
export const waitForBlockedStatement = async (timeoutMs = 3000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()
    `)) as unknown as { n: number }[]
    if (Number(rows[0]?.n ?? 0) > 0) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return false
}

/**
 * `waitForBlockedStatement`, for the tests where being blocked IS the assertion.
 *
 * `reason` names what was supposed to be waiting, so a failure says which claim is
 * missing rather than "timed out".
 */
export const waitUntilBlocked = async (reason: string, timeoutMs = 3000): Promise<void> => {
  if (!(await waitForBlockedStatement(timeoutMs))) throw new Error(reason)
}

/**
 * Opens the connections a race needs before the race starts.
 *
 * postgres.js connects lazily, so without this the second caller spends its first
 * statement on a TCP handshake and the two never overlap.
 */
export const warmPool = async (connections = 4): Promise<void> => {
  await Promise.all(Array.from({ length: connections }, () => db.execute(sql`SELECT 1`)))
}

/**
 * A promise the other half of a race can open.
 *
 * The holder transaction has to have taken its lock BEFORE the contender starts,
 * or the contender wins by getting there first and the test proves nothing.
 * Declaring the transaction first is not enough: postgres.js acquires the
 * connection and sends BEGIN asynchronously, so the contender's first statement
 * can overtake it.
 */
export const latch = (): { opened: Promise<void>; open: () => void } => {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}
