import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { signToken } from '@/lib/auth/jwt'
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
  overrides?: { status?: string; pipelineId?: string[]; isTrial?: boolean },
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

export const makeAuthHeader = async (user: schema.User): Promise<string> => {
  const token = await signToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  })
  return `Bearer ${token}`
}

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
