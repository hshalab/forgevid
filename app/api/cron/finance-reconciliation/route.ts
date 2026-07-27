import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'

/**
 * POST /api/cron/finance-reconciliation — the daily cost/revenue
 * reconciliation the evidence plan calls for. Until now reconciliation was
 * event-driven (Stripe webhooks) plus on-demand admin views; nothing
 * snapshotted the ledger on a schedule, so "reconcile costs and revenue
 * daily" had no daily artifact. This appends one tamper-evident
 * `finance.daily_reconciliation` record per UTC day to the append-only
 * evidence chain — a dated, hash-linked P&L trail a judge can verify
 * rather than a number computed on demand at export time.
 *
 * The numbers are getHackathonEvidence()'s own summary, NOT a re-computed
 * aggregation: a first draft re-aggregated Payment rows here and produced
 * figures that disagreed with the evidence page (different user scoping,
 * different lead-revenue filter, and a 100x unit error from assuming
 * Payment.amount is cents — it's dollars; the Stripe webhook divides by
 * 100 at write time). Snapshotting the shared summary guarantees this
 * chain entry always matches the admin page, CSV, and signed exports.
 *
 * Auth + trigger match the inventory cron: Bearer CRON_SECRET, fired by
 * .github/workflows/finance-reconciliation.yml (or scripts/finance-cron.cmd
 * while GitHub Actions is unavailable). Idempotent per UTC day — a re-fire
 * is a cheap no-op. (The findFirst check isn't atomic with the append, so
 * two triggers landing in the same second could each append; both records
 * would be valid and identical in substance, so no guard is warranted.)
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const day = new Date().toISOString().slice(0, 10)
  const existing = await prisma.evidenceRecord.findFirst({
    where: { kind: 'finance.daily_reconciliation', entityId: day },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ ok: true, day, skipped: 'already reconciled today' })
  }

  const evidence = await getHackathonEvidence()
  const s = evidence.summary
  const netUsd = s.revenueUsd + s.outboundRevenueUsd - s.aiCostUsd - s.operatingCostUsd

  const summary = {
    day,
    since: evidence.start.toISOString(),
    revenueUsd: Number(s.revenueUsd.toFixed(2)),
    relatedPartyRevenueUsd: Number(s.relatedPartyRevenueUsd.toFixed(2)),
    outboundRevenueUsd: Number(s.outboundRevenueUsd.toFixed(2)),
    outboundRelatedPartyRevenueUsd: Number(s.outboundRelatedPartyRevenueUsd.toFixed(2)),
    aiCostUsd: Number(s.aiCostUsd.toFixed(4)),
    operatingCostUsd: Number(s.operatingCostUsd.toFixed(2)),
    marketingSpendUsd: Number(s.marketingSpendUsd.toFixed(2)),
    netUsd: Number(netUsd.toFixed(2)),
    users: s.users,
    activatedUsers: s.activatedUsers,
    videos: s.videos,
    completedVideos: s.completedVideos,
  }

  await appendEvidence({
    kind: 'finance.daily_reconciliation',
    entityType: 'FinanceDay',
    entityId: day,
    payload: summary,
  })

  return NextResponse.json({ ok: true, ...summary })
}
