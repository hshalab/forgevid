import { NextRequest, NextResponse } from 'next/server'
import { evaluateCanaries } from '@/lib/canary-guard'

/**
 * POST /api/cron/canary-guard — metric-triggered automatic rollback for
 * optimization canaries (lib/canary-guard.ts). Idempotent and cheap when
 * no canaries are live; auth + trigger pattern matches the other crons
 * (Bearer CRON_SECRET, fired by .github/workflows/canary-guard.yml or the
 * Windows Task Scheduler fallback scripts/canary-cron.cmd).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const verdicts = await evaluateCanaries()
  return NextResponse.json({
    ok: true,
    canaries: verdicts.length,
    rolledBack: verdicts.filter((verdict) => verdict.action === 'rolled_back').length,
    verdicts,
  })
}
