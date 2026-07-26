import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recordApprovalEvent } from '@/lib/approval-events'
import { appendEvidence } from '@/lib/evidence-ledger'

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  action: z.enum(['approve', 'reject', 'request_revision']),
  note: z.string().trim().max(1000).default(''),
  rightsConfirmed: z.boolean().default(false),
})

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bulk review' }, { status: 400 })
  const { ids, action, note, rightsConfirmed } = parsed.data
  if (action !== 'approve' && !note) return NextResponse.json({ error: 'A note is required' }, { status: 400 })
  if (action === 'approve' && !rightsConfirmed) return NextResponse.json({ error: 'Rights confirmation is required' }, { status: 400 })
  const creatives = await prisma.adCreative.findMany({ where: { id: { in: ids }, userId: session.user.id } })
  if (creatives.length !== new Set(ids).size) return NextResponse.json({ error: 'One or more creatives were not found' }, { status: 404 })
  if (action === 'approve') {
    const videoIds = creatives.map((creative) => creative.videoId).filter((id): id is string => Boolean(id))
    const completed = await prisma.video.count({ where: { id: { in: videoIds }, userId: session.user.id, status: 'COMPLETED' } })
    if (completed !== creatives.length) return NextResponse.json({ error: 'Every selected video must be completed' }, { status: 409 })
  }
  const updated = []
  for (const creative of creatives) {
    const item = await prisma.adCreative.update({
      where: { id: creative.id },
      data: action === 'approve' ? {
        approvalStatus: 'APPROVED',
        rightsStatus: 'CONFIRMED',
        approvedRevision: creative.revision,
        approvedAt: new Date(),
        approvedByUserId: session.user.id,
        reviewNote: note || null,
      } : {
        approvalStatus: action === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED',
        approvedRevision: null,
        approvedAt: null,
        approvedByUserId: null,
        reviewNote: note,
      },
    })
    updated.push(item)
    await recordApprovalEvent({ creative: item, action: `bulk_${action}`, actorUserId: session.user.id, rightsConfirmed, note })
  }
  await appendEvidence({
    kind: `campaign.bulk_${action}`,
    entityType: 'AdCreativeBatch',
    actorUserId: session.user.id,
    payload: { creativeIds: updated.map((item) => item.id), revisions: updated.map((item) => item.revision), rightsConfirmed, note },
  })
  return NextResponse.json({ updated: updated.length })
}
