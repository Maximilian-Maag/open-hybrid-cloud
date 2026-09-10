import { NextResponse } from 'next/server'
import { runBootstrap } from '@/lib/bootstrap'
import { configProblems } from '@/lib/config/validate'

export async function GET() {
  await runBootstrap()

  // Still 200 with problems present: this endpoint is the container health probe
  // and the readiness gate for the e2e suite, and failing it would replace a
  // diagnosable "logins are broken" with an undiagnosable "nothing starts".
  const problems = configProblems()
  if (problems.length > 0) {
    return NextResponse.json({
      status: 'ok',
      warnings: problems.map((p) => `${p.variable} ${p.message}`),
    })
  }

  return NextResponse.json({ status: 'ok' })
}
