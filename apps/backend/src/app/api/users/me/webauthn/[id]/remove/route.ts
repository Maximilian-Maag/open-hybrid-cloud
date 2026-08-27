import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { removeCredential } from '@/lib/services/webauthn'
import { parseRouteId, invalidId, toResponse } from '@/lib/http'

const RemoveSchema = z.object({
  password: z.string().min(1),
})

/**
 * Remove one security key, on proof of the account password (#231).
 *
 * POST rather than the `DELETE /users/me/webauthn/:id` it replaces, and the
 * reason is not taste: the browser reaches this API through `/api/proxy` since
 * #146, and that route deliberately drops the body of a DELETE — so a password
 * sent that way would arrive as `undefined` and every removal would fail with
 * "current password is incorrect". The old endpoint is gone rather than kept
 * beside this one; leaving it would leave the hole open.
 *
 * `requireAuth`, not the pending variant: an account that owes a factor has none
 * to remove, and the surface an un-enrolled administrator can reach should be
 * the smallest thing that lets them enrol.
 *
 * The service still refuses to remove the LAST factor an account has. That is
 * the difference from a confirmed TOTP secret, which cannot be removed at all: a
 * credential must be removable, because a lost key that stays registered keeps
 * prompting for something the user no longer has.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const credentialId = parseRouteId(id)
  if (credentialId === null) return invalidId('security key')

  const body = await req.json().catch(() => null)
  const parsed = RemoveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await removeCredential(session.id, credentialId, parsed.data.password))
}
