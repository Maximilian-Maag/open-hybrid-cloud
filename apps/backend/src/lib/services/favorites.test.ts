import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { listFavorites, addFavorite, removeFavorite } from './favorites'
import { db } from '@/lib/db/client'
import { productFavorites, productTranslations, users, products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, createCategory, createProduct } from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const setup = async () => {
  const user = await createUser({ role: 'project_manager', email: 'fav-user@test.dev' })
  const other = await createUser({ role: 'project_manager', email: 'fav-other@test.dev' })
  const cat = await createCategory()
  const nginx = await createProduct(cat.id, 'Nginx Gateway')
  const postgres = await createProduct(cat.id, 'Managed Postgres')
  return { user, other, cat, nginx, postgres }
}

describe('addFavorite', () => {
  it('stores a favourite for the caller', async () => {
    const { user, nginx } = await setup()
    const result = await addFavorite(makeSession(user), nginx.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(productFavorites).where(eq(productFavorites.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].productId).toBe(nginx.id)
  })

  it('is idempotent — starring twice is a no-op success', async () => {
    // The UI toggles optimistically, so a double-fire from an impatient click
    // must not surface as a conflict.
    const { user, nginx } = await setup()
    expect((await addFavorite(makeSession(user), nginx.id)).ok).toBe(true)
    expect((await addFavorite(makeSession(user), nginx.id)).ok).toBe(true)

    const rows = await db.select().from(productFavorites).where(eq(productFavorites.userId, user.id))
    expect(rows).toHaveLength(1)
  })

  it('rejects a product that does not exist', async () => {
    const { user } = await setup()
    const result = await addFavorite(makeSession(user), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('removeFavorite', () => {
  it('removes only the caller\'s favourite', async () => {
    const { user, other, nginx } = await setup()
    await addFavorite(makeSession(user), nginx.id)
    await addFavorite(makeSession(other), nginx.id)

    expect((await removeFavorite(makeSession(user), nginx.id)).ok).toBe(true)

    const mine = await db.select().from(productFavorites).where(eq(productFavorites.userId, user.id))
    const theirs = await db.select().from(productFavorites).where(eq(productFavorites.userId, other.id))
    expect(mine).toHaveLength(0)
    // One user un-starring must not touch another's list.
    expect(theirs).toHaveLength(1)
  })

  it('is idempotent — removing one that is not there succeeds', async () => {
    const { user, nginx } = await setup()
    const result = await removeFavorite(makeSession(user), nginx.id)
    expect(result.ok).toBe(true)
  })
})

describe('listFavorites', () => {
  it('returns only the caller\'s favourites', async () => {
    const { user, other, nginx, postgres } = await setup()
    await addFavorite(makeSession(user), nginx.id)
    await addFavorite(makeSession(other), postgres.id)

    const result = await listFavorites(makeSession(user), 'en')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((f) => f.productId)).toEqual([nginx.id])
  })

  it('resolves the product name and category for rendering a card', async () => {
    const { user, cat, nginx } = await setup()
    await addFavorite(makeSession(user), nginx.id)

    const result = await listFavorites(makeSession(user), 'en')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0]).toMatchObject({
      productId: nginx.id,
      categoryId: cat.id,
      name: 'Nginx Gateway',
    })
  })

  it('falls back to English when the requested language has no translation', async () => {
    const { user, nginx } = await setup()
    await addFavorite(makeSession(user), nginx.id)

    const result = await listFavorites(makeSession(user), 'fr')
    expect(result.ok && result.data[0].name).toBe('Nginx Gateway')
  })

  it('prefers the requested language when it does exist', async () => {
    const { user, nginx } = await setup()
    await db.insert(productTranslations).values({
      productId: nginx.id,
      languageCode: 'de',
      name: 'Nginx-Gateway',
      description: 'Beschreibung',
    })
    await addFavorite(makeSession(user), nginx.id)

    const result = await listFavorites(makeSession(user), 'de')
    expect(result.ok && result.data[0].name).toBe('Nginx-Gateway')
  })

  it('lists the most recently favourited first', async () => {
    const { user, nginx, postgres } = await setup()
    await addFavorite(makeSession(user), nginx.id)
    // Force a distinct timestamp — both inserts land inside the same tick.
    await db
      .update(productFavorites)
      .set({ createdAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(productFavorites.productId, nginx.id))
    await addFavorite(makeSession(user), postgres.id)

    const result = await listFavorites(makeSession(user), 'en')
    expect(result.ok && result.data.map((f) => f.productId)).toEqual([postgres.id, nginx.id])
  })

  it('returns an empty list for a user with no favourites', async () => {
    const { user } = await setup()
    const result = await listFavorites(makeSession(user), 'en')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('drops the favourite when the product is deleted', async () => {
    // The FK cascades, so a deleted product cannot leave the catalogue filtering
    // against an id that no longer resolves.
    const { user, nginx } = await setup()
    await addFavorite(makeSession(user), nginx.id)
    await db.delete(products).where(eq(products.id, nginx.id))

    const result = await listFavorites(makeSession(user), 'en')
    expect(result.ok && result.data).toEqual([])
  })

  it('drops the favourite when the user is deleted', async () => {
    const { user, nginx } = await setup()
    await addFavorite(makeSession(user), nginx.id)
    await db.delete(users).where(eq(users.id, user.id))

    const rows = await db.select().from(productFavorites).where(eq(productFavorites.productId, nginx.id))
    expect(rows).toEqual([])
  })
})
