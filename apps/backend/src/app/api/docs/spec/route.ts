import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import '@/lib/openapi/paths'
import { generateOpenApiDocument } from '@/lib/openapi/registry'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const spec = generateOpenApiDocument()
  return NextResponse.json(spec)
}
