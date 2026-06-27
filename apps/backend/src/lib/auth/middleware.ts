import { type NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './jwt'
import type { SessionUser, Role } from '@open-hybrid-cloud/types'

const ROLE_RANK: Record<Role, number> = { project_manager: 1, admin: 2, root: 3 }

export const getSession = async (req: NextRequest): Promise<SessionUser | null> => {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return verifyToken(auth.slice(7))
}

export const requireAuth = async (req: NextRequest): Promise<SessionUser | NextResponse> => {
  const user = await getSession(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return user
}

export const requireRole =
  (minRole: Role) =>
  async (req: NextRequest): Promise<SessionUser | NextResponse> => {
    const result = await requireAuth(req)
    if (result instanceof NextResponse) return result
    if (ROLE_RANK[result.role] < ROLE_RANK[minRole])
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return result
  }

export const isAuth = (v: SessionUser | NextResponse): v is SessionUser =>
  !(v instanceof NextResponse)
