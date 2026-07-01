import { NextResponse } from 'next/server'
import type { Result } from '@/lib/services/result'

export const toResponse = <T>(result: Result<T>, successStatus = 200): NextResponse =>
  result.ok
    ? NextResponse.json(result.data ?? { success: true }, { status: successStatus })
    : NextResponse.json({ error: result.message }, { status: result.status })
