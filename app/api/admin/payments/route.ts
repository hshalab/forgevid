import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/rbac'
import { appendEvidence } from '@/lib/evidence-ledger'

/**
 * Admin payment ledger — the missing edit surface for related-party
 * classification. Leads have had a per-row isRelatedParty toggle
 * (app/api/admin/leads) since the attribution work; Payment rows could only
 * be reclassified by editing the database directly, which contradicts the
 * evidence methodology ("flip explicitly per row", schema comment) and
 * leaves no audit trail. Every flip here is appended to the tamper-evident
 * evidence ledger so the judged-revenue exclusions are themselves evidenced.
 *
 * Unlike leads (each admin's private outbound pipeline), payments are the
 * company ledger — one shared books, so no per-admin scoping.
 */

const updatePaymentSchema = z.object({
  id: z.string().min(1),
  isRelatedParty: z.boolean(),
})

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      isRelatedParty: true,
      stripePaymentId: true,
      createdAt: true,
      user: { select: { email: true } },
      subscription: { select: { plan: true } },
    },
  })
  return NextResponse.json({ payments })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = updatePaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const existing = await prisma.payment.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, isRelatedParty: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.isRelatedParty === parsed.data.isRelatedParty) {
    return NextResponse.json({ payment: existing })
  }

  // Compare-and-set on the value we read, so a concurrent flip can't append
  // an evidence record whose `from` never matched the row. count 0 means
  // someone else already changed it — return the current state, no record.
  const updated = await prisma.payment.updateMany({
    where: { id: existing.id, isRelatedParty: existing.isRelatedParty },
    data: { isRelatedParty: parsed.data.isRelatedParty },
  })
  if (updated.count === 0) {
    const current = await prisma.payment.findUnique({
      where: { id: existing.id },
      select: { id: true, isRelatedParty: true },
    })
    return NextResponse.json({ payment: current })
  }

  // Update-then-append, not atomic (appendEvidence runs its own serializable
  // transaction for the hash chain): a crash between the two leaves a flipped
  // row without its flip record. Accepted — the daily finance snapshot also
  // captures classification totals, so any drift is detectable; the reverse
  // order would be worse (an evidence record for a flip that never happened).
  await appendEvidence({
    kind: 'payment.related_party_flag',
    entityType: 'Payment',
    entityId: existing.id,
    actorUserId: admin.id,
    payload: { from: existing.isRelatedParty, to: parsed.data.isRelatedParty },
  })

  return NextResponse.json({ payment: { id: existing.id, isRelatedParty: parsed.data.isRelatedParty } })
}
