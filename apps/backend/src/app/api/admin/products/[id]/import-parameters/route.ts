import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { parseRouteId, invalidId, toResponse } from '@/lib/http'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err } from '@/lib/services/result'
import { scanTemplate, importScannedParameters } from '@/lib/services/admin/templateImport'
import type { CiProvider } from '@open-hybrid-cloud/types'

const ImportSchema = z.object({
  ciSourceId: z.number().int().positive(),
  /** Numeric id or URL-encoded path, whichever the provider wants. */
  projectId: z.string().min(1),
  ref: z.string().min(1),
  /** Directory of the root template, repository-relative. '' is the repository root. */
  path: z.string(),
})

/**
 * Import a product's parameters straight from a repository path.
 *
 * The sibling `sync-parameters` derives all four of these from a pipeline stack,
 * which is why it cannot run before one exists (#248) and why it always reads
 * `main`. This one is told where to look, so parameters can be imported while
 * the product is still being set up — and from a branch, which is how a template
 * change is tried out before it is merged.
 *
 * The scan reads every `.tf` in the directory and follows local `module` sources,
 * because a template built out of modules declares few variables of its own.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')

  const body = await req.json().catch(() => null)
  const parsed = ImportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [src] = await db
    .select()
    .from(ciSources)
    .where(eq(ciSources.id, parsed.data.ciSourceId))
    .limit(1)
  if (!src) return toResponse(err(404, 'CI source not found'))

  const source = { url: src.url, accessToken: src.accessToken, provider: src.provider as CiProvider }

  try {
    const scan = await scanTemplate(source, parsed.data.projectId, parsed.data.ref, parsed.data.path)
    // An empty scan is not an error, and saying which files were read is what
    // tells the operator whether the path was wrong or the template simply
    // declares nothing.
    return toResponse(ok(await importScannedParameters(productId, scan, session.id)))
  } catch (e) {
    console.error('[import-parameters]', e)
    return toResponse(
      err(422, `Could not read ${parsed.data.path || 'the repository root'} at ${parsed.data.ref}: ${e instanceof Error ? e.message : String(e)}`),
    )
  }
}
