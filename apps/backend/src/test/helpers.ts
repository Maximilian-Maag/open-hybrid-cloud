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

export const createEnvironment = async (ciSourceId: number, webhookToken = 'wh-secret') => {
  const [env] = await db
    .insert(schema.deploymentEnvironments)
    .values({
      name: 'Test Env',
      ciSourceId,
      webhookUrl: 'https://gitlab.example.com/api/v4/projects/1/trigger/pipeline',
      webhookToken,
    })
    .returning()
  return env
}

export const createProject = async (ownerId: number) => {
  const [project] = await db
    .insert(schema.projects)
    .values({ name: 'Test Project', ownerId })
    .returning()
  return project
}

export const createOrder = async (
  projectId: number,
  productId: number,
  environmentId: number,
  userId: number,
  overrides?: { status?: string; pipelineId?: string[] },
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
    })
    .returning()
  return order
}

export const createInfraElement = async (
  orderId: number,
  projectId: number,
  environmentId: number,
  productId: number,
  overrides?: { status?: string; pipelineId?: string[] },
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
    })
    .returning()
  return el
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
