import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCategories, createCategory } from '@/lib/services/admin/categories'

const CreateCategorySchema = z.object({
  name: z.string().min(1),
  displayOrder: z.number().int().default(0),
})

/**
 * The category list, readable by any signed-in account.
 *
 * `requireAuth`, not `requireRole('root')`, because this list is the shop's
 * navigation as much as it is the admin table — `listCategories` says so, and
 * the catalogue page and the product detail page both fetch it to build the
 * category filter and the breadcrumb. Gated on `root` it returned 403 to every
 * project manager and admin, and the catalogue page fetches it alongside the
 * products in one `Promise.all`, so the whole shop rendered as an error for
 * everyone who was not root — the one role that could not see the bug.
 *
 * Nothing here is privileged: retired categories are already excluded, so what
 * this returns is exactly the set of names the caller is about to see printed on
 * the products anyway. Writing is a different question, and POST below is still
 * `root`. This is the same split `admin/cost-centers` already makes for the same
 * reason — an ordering screen cannot work without reading the list.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  return toResponse(await listCategories())
}

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createCategory(parsed.data, session.id), 201)
}
