import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadScenes, planRerender, rerenderVideo, saveScenes, setStage } from '@/lib/generation-pipeline'
import { enqueueRerender } from '@/lib/video-queue'
import { withRenderSlot } from '@/lib/render-semaphore'
import { recordApprovalEvent } from '@/lib/approval-events'
import { appendEvidence } from '@/lib/evidence-ledger'

const schema = z.object({
  hookNarration: z.string().trim().min(5).max(500).optional(),
  ctaNarration: z.string().trim().min(5).max(500).optional(),
  note: z.string().trim().min(3).max(1000),
}).refine((value) => value.hookNarration || value.ctaNarration, {
  message: 'Change a hook, a CTA, or both',
})

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid selective revision', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await props.params
  const creative = await prisma.adCreative.findFirst({ where: { id, userId: session.user.id } })
  if (!creative?.videoId) return NextResponse.json({ error: 'Creative video not found' }, { status: 404 })
  const scenes = await loadScenes(creative.videoId)
  if (!scenes.length) return NextResponse.json({ error: 'This video has no editable scenes' }, { status: 422 })
  try {
    await planRerender(creative.videoId)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Revision cannot be rendered' }, { status: 422 })
  }
  const revised = scenes.map((scene, index) => ({
    ...scene,
    ...(index === 0 && parsed.data.hookNarration ? { narration: parsed.data.hookNarration } : {}),
    ...(index === scenes.length - 1 && parsed.data.ctaNarration ? { narration: parsed.data.ctaNarration } : {}),
  }))
  await saveScenes(creative.videoId, revised)
  const updated = await prisma.adCreative.update({
    where: { id },
    data: {
      ...(parsed.data.hookNarration && { hook: parsed.data.hookNarration }),
      ...(parsed.data.ctaNarration && { cta: parsed.data.ctaNarration }),
      revision: { increment: 1 },
      approvalStatus: 'AWAITING_REVIEW',
      rightsStatus: 'UNCONFIRMED',
      approvedRevision: null,
      approvedAt: null,
      approvedByUserId: null,
      reviewNote: parsed.data.note,
    },
  })
  await setStage(creative.videoId, 'queued')
  const jobId = await enqueueRerender({ videoId: creative.videoId, userId: session.user.id })
  if (!jobId) void withRenderSlot(() => rerenderVideo(creative.videoId!)).catch((error) => console.error('[selective-regeneration]', error))
  await recordApprovalEvent({
    creative: updated,
    action: 'selective_regeneration',
    actorUserId: session.user.id,
    rightsConfirmed: false,
    note: parsed.data.note,
  })
  await appendEvidence({
    kind: 'campaign.selective_regeneration',
    entityType: 'AdCreative',
    entityId: id,
    actorUserId: session.user.id,
    payload: {
      revision: updated.revision,
      hookChanged: Boolean(parsed.data.hookNarration),
      ctaChanged: Boolean(parsed.data.ctaNarration),
      note: parsed.data.note,
    },
  })
  return NextResponse.json({ creative: updated, videoId: creative.videoId, jobId, status: 'queued' })
}
