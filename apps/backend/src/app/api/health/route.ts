import { NextResponse } from 'next/server'
import { runBootstrap } from '@/lib/bootstrap'

export async function GET() {
  await runBootstrap()
  return NextResponse.json({ status: 'ok' })
}
