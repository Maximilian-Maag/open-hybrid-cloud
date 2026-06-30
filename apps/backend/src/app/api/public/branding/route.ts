import { NextResponse } from 'next/server'
import { getBranding } from '@/lib/services/admin/branding'

export async function GET() {
  const result = await getBranding()
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  const { primaryColor, secondaryColor, shopName, shopSubtitle, imprintText, logoMime } = result.data
  return NextResponse.json({ primaryColor, secondaryColor, shopName, shopSubtitle, imprintText, logoMime })
}
