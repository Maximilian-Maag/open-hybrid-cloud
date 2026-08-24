import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { removeCredential } from '@/lib/services/webauthn'
import { parseRouteId, invalidId, toResponse } from '@/lib/http'

/**
 * Remove one security key (issue #197, part 2).
 *
 * `requireAuth`, not the pending variant: an account that owes a factor has none
 * to remove, and the surface an un-enrolled administrator can reach should be the
 * smallest thing that lets them enrol.
 *
 * The service refuses to remove the last factor an account has. That is the
 * difference from a confirmed TOTP secret, which cannot be removed at all: a
 * credential must be removable, because a lost key that stays registered keeps
 * prompting for something the user no longer has.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const credentialId = parseRouteId(id)
  if (credentialId === null) return invalidId('security key')

  return toResponse(await removeCredential(session.id, credentialId))
}
