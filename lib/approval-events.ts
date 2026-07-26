import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export async function recordApprovalEvent(input: {
  creative: {
    id: string
    revision: number
    approvalStatus: string
    rightsStatus: string
    approvedRevision?: number | null
    videoId?: string | null
  }
  action: string
  actorUserId: string
  rightsConfirmed: boolean
  note?: string
}) {
  const snapshot = JSON.stringify({
    creativeId: input.creative.id,
    revision: input.creative.revision,
    approvalStatus: input.creative.approvalStatus,
    rightsStatus: input.creative.rightsStatus,
    approvedRevision: input.creative.approvedRevision ?? null,
    videoId: input.creative.videoId ?? null,
  })
  return prisma.campaignApprovalEvent.create({
    data: {
      creativeId: input.creative.id,
      revision: input.creative.revision,
      action: input.action,
      actorUserId: input.actorUserId,
      rightsConfirmed: input.rightsConfirmed,
      note: input.note || null,
      snapshot,
      snapshotHash: createHash('sha256').update(snapshot).digest('hex'),
    },
  })
}
