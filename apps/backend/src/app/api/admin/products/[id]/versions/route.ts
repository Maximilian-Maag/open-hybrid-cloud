import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listProductVersions } from '@/lib/services/versions'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  return toResponse(await listProductVersions(id))
}
