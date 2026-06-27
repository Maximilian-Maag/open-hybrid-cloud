import { type NextRequest, NextResponse } from 'next/server'
import { decodeJwt } from 'jose'
import { signToken } from '@/lib/auth/jwt'
import { upsertSsoUser } from '@/lib/services/auth'
import type { Role } from '@open-hybrid-cloud/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 })
  }

  const tenantId = process.env.ENTRA_TENANT_ID
  const clientId = process.env.ENTRA_CLIENT_ID
  const clientSecret = process.env.ENTRA_CLIENT_SECRET
  const redirectUri = process.env.ENTRA_REDIRECT_URI
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: 'Entra ID not configured' }, { status: 500 })
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.error('[callback] Token exchange failed:', text)
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 502 })
  }

  const tokenData = await tokenRes.json() as { id_token: string }
  const claims = decodeJwt(tokenData.id_token) as {
    sub: string
    email?: string
    preferred_username?: string
    name?: string
  }

  const sub = claims.sub
  const email = claims.email ?? claims.preferred_username ?? ''
  const name = claims.name ?? email

  if (!sub || !email) {
    return NextResponse.json({ error: 'Missing claims in ID token' }, { status: 400 })
  }

  const user = await upsertSsoUser(sub, email, name)
  if (!user) {
    return NextResponse.redirect(`${frontendUrl}/?error=account_error`)
  }

  if (!user.active) {
    return NextResponse.redirect(`${frontendUrl}/?error=account_disabled`)
  }

  const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role as Role }
  const jwt = await signToken(sessionUser)

  return NextResponse.redirect(`${frontendUrl}/?token=${jwt}`)
}
