import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'

const JUDGE_EMAIL = 'judge@forgevid.com'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || session.user.email?.toLowerCase() !== JUDGE_EMAIL) {
    return NextResponse.json({ error: 'Judge demo account required' }, { status: 403 })
  }
  const userId = session.user.id
  await prisma.$transaction(async (tx) => {
    const creatives = await tx.adCreative.findMany({ where: { userId }, select: { id: true } })
    const creativeIds = creatives.map((creative) => creative.id)
    if (creativeIds.length) await tx.creativeEvent.deleteMany({ where: { creativeId: { in: creativeIds } } })
    await tx.growthConversion.deleteMany({ where: { userId } })
    await tx.adCreative.deleteMany({ where: { userId } })
    await tx.adCampaign.deleteMany({ where: { userId } })
    await tx.inventoryItem.deleteMany({ where: { userId } })
    await tx.aIGeneration.deleteMany({ where: { userId } })
    await tx.usageRecord.deleteMany({ where: { userId } })
    await tx.notification.deleteMany({ where: { userId } })
    await tx.growthOperatorSchedule.deleteMany({ where: { userId } })
    await tx.impactAssumption.deleteMany({ where: { userId } })
    await tx.video.deleteMany({ where: { userId } })

    const seenAt = new Date('2026-07-01T12:00:00.000Z')
    const samples = [
      { vertical: 'auto', externalRef: 'JUDGE-AUTO-001', label: '2024 ForgeVid Demo SUV', priceText: '$31,900', photoCount: 6 },
      { vertical: 'realestate', externalRef: 'JUDGE-HOME-001', label: '1925 Demo Street, Miami, FL', priceText: '$625,000', photoCount: 8 },
      { vertical: 'ecom', externalRef: 'JUDGE-SKU-001', label: 'ForgeVid Demo Travel Bag', priceText: '$89', photoCount: 5 },
    ]
    for (const sample of samples) {
      await tx.inventoryItem.create({ data: { userId, ...sample, firstSeenAt: seenAt, lastSeenAt: seenAt } })
    }
  })
  await appendEvidence({
    kind: 'judge_demo.reset',
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    payload: { dataset: 'judge-demo-v1', inventoryItems: 3, genuineEvidenceAffected: false },
  })
  return NextResponse.json({
    ok: true,
    message: 'Judge workspace reset to three deterministic sample inventory items. Production evidence was not changed.',
  })
}
