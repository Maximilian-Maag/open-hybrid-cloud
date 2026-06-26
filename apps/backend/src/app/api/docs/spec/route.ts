import { NextResponse } from 'next/server'
import { generateOpenApiDocument } from '@/lib/openapi/registry'

export async function GET() {
  const spec = generateOpenApiDocument()
  return NextResponse.json(spec)
}
