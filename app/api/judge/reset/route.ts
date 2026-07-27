import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { JUDGE_DEMO_DATASET, JUDGE_DEMO_INVENTORY, JUDGE_DEMO_SEEN_AT, JUDGE_EMAIL } from '@/lib/judge-demo'

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

    for (const sample of JUDGE_DEMO_INVENTORY) {
      await tx.inventoryItem.create({
        data: { userId, ...sample, firstSeenAt: JUDGE_DEMO_SEEN_AT, lastSeenAt: JUDGE_DEMO_SEEN_AT },
      })
    }
  })
  await appendEvidence({
    kind: 'judge_demo.reset',
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    payload: { dataset: JUDGE_DEMO_DATASET, inventoryItems: JUDGE_DEMO_INVENTORY.length, genuineEvidenceAffected: false },
  })
  return NextResponse.json({
    ok: true,
    message: 'Judge workspace reset to three deterministic sample inventory items. Production evidence was not changed.',
  })
}
