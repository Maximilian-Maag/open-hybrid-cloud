import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DELETE, GET } from './route'
import { POST as ENROLL } from './enroll/route'
import { POST as CONFIRM } from './confirm/route'
import { createUser, currentTotpCode, enrollTotp, makeAuthHeader } from '@/test/helpers'
import { base32Decode } from '@/lib/auth/totp'
import { MFA_MAX_FAILED_ATTEMPTS, RECOVERY_CODE_COUNT } from '@/lib/services/twoFactor'
import { db } from '@/lib/db/client'
import { branding } from '@/lib/db/schema'

const makeReq = (path: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

describe('GET /api/users/me/2fa', () => {
  it('requires a session', async () => {
    expect((await GET(makeReq('/api/users/me/2fa'))).status).toBe(401)
  })

  it('reports the status without leaking the secret', async () => {
    const u = await createUser({ role: 'root' })
    await enrollTotp(u.id)

    const res = await GET(makeReq('/api/users/me/2fa', 'GET', undefined, await makeAuthHeader(u)))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(Object.keys(body).sort()).toEqual([
      'confirmedAt',
      'enabled',
      'lockedUntil',
      'pending',
      'recoveryCodesRemaining',
    ])
  })

  it('refuses a non-root session — #36 is 2FA for the root account', async () => {
    const u = await createUser({ role: 'admin' })
    const res = await GET(makeReq('/api/users/me/2fa', 'GET', undefined, await makeAuthHeader(u)))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/root account only/)
  })
})

describe('DELETE /api/users/me/2fa', () => {
  it('refuses, because a confirmed factor cannot be switched off', async () => {
    const res = await DELETE()
    expect(res.status).toBe(405)
    expect((await res.json()).error).toMatch(/cannot be disabled/)
  })

  it('no route under api/ offers a way to clear a confirmed factor', () => {
    // A cheap structural guard on the acceptance criterion: the only exit is a
    // re-enrollment or an operator in the database. If someone adds a disable
    // endpoint, this fails and they have to argue with the issue.
    const twoFaDir = join(process.cwd(), 'src/app/api/users/me/2fa')
    const routes = readdirSync(twoFaDir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name === 'route.ts')
      .map((e) => join(e.parentPath ?? twoFaDir, e.name))

    expect(routes.length).toBeGreaterThanOrEqual(3)
    for (const file of routes) {
      const source = readFileSync(file, 'utf8')
      // Nothing in the 2FA surface may null out the live secret or the
      // confirmation timestamp.
      expect(source, file).not.toMatch(/secret:\s*null/)
      expect(source, file).not.toMatch(/confirmedAt:\s*null/)
    }
  })
})

describe('POST /api/users/me/2fa/enroll', () => {
  it('requires a session', async () => {
    expect((await ENROLL(makeReq('/x', 'POST', { password: 'p' }))).status).toBe(401)
  })

  it('requires the current password', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const res = await ENROLL(
      makeReq('/x', 'POST', { password: 'wrong-one' }, await makeAuthHeader(u)),
    )
    // 403, not 401: the browser's API client signs the user out on a 401, and a
    // mistyped password must not become a surprise logout.
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/password is incorrect/)
  })

  it('offers a QR code, a key URI and a typable secret', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const res = await ENROLL(makeReq('/x', 'POST', { password: 'right-one' }, await makeAuthHeader(u)))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.qrSvg.startsWith('<svg')).toBe(true)
    expect(body.otpauthUrl.startsWith('otpauth://totp/')).toBe(true)
    expect(base32Decode(body.secret)).toHaveLength(20)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })

  it('names the configured shop as the issuer, so the app entry is recognisable', async () => {
    await db.update(branding).set({ shopName: 'Acme Cloud' })
    const u = await createUser({ password: 'right-one', role: 'root' })
    const res = await ENROLL(makeReq('/x', 'POST', { password: 'right-one' }, await makeAuthHeader(u)))
    const body = await res.json()
    expect(new URL(body.otpauthUrl).searchParams.get('issuer')).toBe('Acme Cloud')
  })

  it('refuses an SSO account, which has no password and no business here', async () => {
    const [u] = await db
      .insert((await import('@/lib/db/schema')).users)
      .values({ email: `sso-${Date.now()}@test.dev`, name: 'SSO', role: 'admin', ssoSub: `s-${Date.now()}`, active: true })
      .returning()

    const res = await ENROLL(makeReq('/x', 'POST', { password: 'anything' }, await makeAuthHeader(u)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/single sign-on/)
  })

  it('demands a current second factor before re-enrolling', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    await enrollTotp(u.id)

    const res = await ENROLL(makeReq('/x', 'POST', { password: 'right-one' }, await makeAuthHeader(u)))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.codeRequired).toBe(true)
    expect(body.secret).toBeUndefined()
  })

  it('re-enrolls with a current code', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const secret = await enrollTotp(u.id)

    const res = await ENROLL(
      makeReq('/x', 'POST', { password: 'right-one', code: currentTotpCode(secret) }, await makeAuthHeader(u)),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).secret).toBeTruthy()
  })

  it('re-enrolls with a recovery code — the path for a lost authenticator', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    await enrollTotp(u.id, { recoveryCodes: ['ABCDE-FGHJK-LMNPQ-RSTUV'] })

    const res = await ENROLL(
      makeReq('/x', 'POST', { password: 'right-one', code: 'ABCDE-FGHJK-LMNPQ-RSTUV' }, await makeAuthHeader(u)),
    )
    expect(res.status).toBe(200)
  })

  it('refuses a re-enrollment with a wrong code', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    await enrollTotp(u.id)

    const res = await ENROLL(
      makeReq('/x', 'POST', { password: 'right-one', code: '000000' }, await makeAuthHeader(u)),
    )
    expect(res.status).toBe(400)
  })

  it('counts a failed re-enrollment code towards the lockout', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    await enrollTotp(u.id)
    const auth = await makeAuthHeader(u)

    let last = 0
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i++) {
      last = (await ENROLL(makeReq('/x', 'POST', { password: 'right-one', code: '000000' }, auth))).status
    }
    expect(last).toBe(429)
  })

  it('rejects a malformed body', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const auth = await makeAuthHeader(u)
    for (const body of [{}, { password: '' }, { password: 'p', code: '' }]) {
      expect((await ENROLL(makeReq('/x', 'POST', body, auth))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('refuses a non-root account even with the right password', async () => {
    for (const role of ['admin', 'project_manager'] as const) {
      const u = await createUser({ password: 'right-one', role })
      const res = await ENROLL(
        makeReq('/x', 'POST', { password: 'right-one' }, await makeAuthHeader(u)),
      )
      expect(res.status, role).toBe(403)
      expect((await res.json()).error).toMatch(/root account only/)
    }
  })
})

describe('POST /api/users/me/2fa/confirm', () => {
  it('requires a session', async () => {
    expect((await CONFIRM(makeReq('/x', 'POST', { code: '123456' }))).status).toBe(401)
  })

  it('activates the factor and returns the recovery codes exactly once', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const auth = await makeAuthHeader(u)

    const enrolled = await (await ENROLL(makeReq('/x', 'POST', { password: 'right-one' }, auth))).json()
    const code = currentTotpCode(base32Decode(enrolled.secret))

    const res = await CONFIRM(makeReq('/x', 'POST', { code }, auth))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)

    const body = await res.json()
    expect(body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT)

    // Asking again gets nothing: they are stored hashed and this response was
    // the only copy.
    const again = await CONFIRM(makeReq('/x', 'POST', { code }, auth))
    expect(again.status).toBe(400)
    expect((await again.json()).recoveryCodes).toBeUndefined()

    const status = await (await GET(makeReq('/api/users/me/2fa', 'GET', undefined, auth))).json()
    expect(status.enabled).toBe(true)
    expect(status.recoveryCodesRemaining).toBe(RECOVERY_CODE_COUNT)
  })

  it('rejects a wrong code without activating anything', async () => {
    const u = await createUser({ password: 'right-one', role: 'root' })
    const auth = await makeAuthHeader(u)
    await ENROLL(makeReq('/x', 'POST', { password: 'right-one' }, auth))

    expect((await CONFIRM(makeReq('/x', 'POST', { code: '000000' }, auth))).status).toBe(400)
    const status = await (await GET(makeReq('/api/users/me/2fa', 'GET', undefined, auth))).json()
    expect(status.enabled).toBe(false)
  })

  it('rejects a malformed body', async () => {
    const u = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(u)
    for (const body of [{}, { code: '' }, { code: 'x'.repeat(65) }]) {
      expect((await CONFIRM(makeReq('/x', 'POST', body, auth))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('refuses a non-root account, without a role check of its own', async () => {
    // The handler has no role branch: the gate is in the service, so this is
    // what proves confirm cannot drift away from enroll.
    const u = await createUser({ role: 'admin' })
    const secret = await enrollTotp(u.id, { confirmed: false })
    const res = await CONFIRM(
      makeReq('/x', 'POST', { code: currentTotpCode(secret) }, await makeAuthHeader(u)),
    )
    expect(res.status).toBe(403)
  })
})
