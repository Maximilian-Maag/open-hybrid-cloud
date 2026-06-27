import { type NextRequest, NextResponse } from 'next/server'
import { getProductImage } from '@/lib/services/catalog'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const result = await getProductImage(parseInt(id, 10))

  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  if (!result.data) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(result.data.data), {
    headers: {
      'Content-Type': result.data.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
