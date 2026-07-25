import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCreativeEvidence } from '@/lib/growth-evidence'

export const runtime = 'nodejs'

interface IncomingCreative {
  videoId?: string
  label?: string
  hook?: string
  cta?: string
  aspect?: string
  recommendationReason?: string
  expectedResult?: string
  estimatedCostCents?: number
}

// POST — persist a campaign + its creatives. The variant videos were already
// created by /api/campaigns/variations; this records the marketing metadata
// (hook/cta/aspect + link to the video) for the campaign view + winners library.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = session.user.id

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, 4000) : ''
  const platform = typeof body.platform === 'string' ? body.platform.slice(0, 20) : 'tiktok'
  const aiDecisionId = typeof body.aiDecisionId === 'string' ? body.aiDecisionId : null
  const creatives: IncomingCreative[] = Array.isArray(body.creatives) ? body.creatives : []

  if (!name || !brief || creatives.length === 0) {
    return NextResponse.json({ error: 'name, brief and at least one creative are required' }, { status: 400 })
  }
  if (creatives.length > 48) {
    return NextResponse.json({ error: 'Too many creatives in one campaign (max 48)' }, { status: 400 })
  }

  // Only link videoIds the caller actually owns.
  const requestedIds = creatives.map((c) => c.videoId).filter((v): v is string => typeof v === 'string')
  const owned = requestedIds.length
    ? await prisma.video.findMany({ where: { id: { in: requestedIds }, userId }, select: { id: true } })
    : []
  const ownedIds = new Set(owned.map((v) => v.id))

  if (aiDecisionId) {
    const ownedDecision = await prisma.aIGeneration.findFirst({
      where: { id: aiDecisionId, userId, type: 'GROWTH_DECISION', status: 'COMPLETED' },
      select: { id: true },
    })
    if (!ownedDecision) {
      return NextResponse.json({ error: 'AI decision not found or not owned by this user' }, { status: 400 })
    }
  }

  const campaign = await prisma.adCampaign.create({ data: { userId, name, brief, platform, aiDecisionId } })

  await prisma.adCreative.createMany({
    data: creatives.map((c) => ({
      userId,
      campaignId: campaign.id,
      videoId: c.videoId && ownedIds.has(c.videoId) ? c.videoId : null,
      label: String(c.label ?? 'variant').slice(0, 120),
      hook: c.hook ? String(c.hook).slice(0, 60) : null,
      cta: c.cta ? String(c.cta).slice(0, 60) : null,
      aspect: c.aspect ? String(c.aspect).slice(0, 10) : null,
      platform,
      recommendationReason: c.recommendationReason
        ? String(c.recommendationReason).slice(0, 1000)
        : 'Generated from the campaign brief and selected creative experiment.',
      expectedResult: c.expectedResult ? String(c.expectedResult).slice(0, 500) : null,
      estimatedCostCents: Number.isInteger(c.estimatedCostCents) && Number(c.estimatedCostCents) >= 0
        ? Number(c.estimatedCostCents)
        : null,
    })),
  })

  return NextResponse.json({ campaignId: campaign.id })
}

// GET — the user's campaigns, each with its creatives joined to live video status.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = session.user.id

  const [campaigns, creatives] = await Promise.all([
    prisma.adCampaign.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.adCreative.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ])

  const videoIds = creatives.map((c) => c.videoId).filter((v): v is string => !!v)
  const [videos, evidence] = await Promise.all([
    videoIds.length
      ? prisma.video.findMany({
        where: { id: { in: videoIds } },
        select: { id: true, status: true, url: true, fileUrl: true, thumbnail: true },
      })
      : Promise.resolve([]),
    getCreativeEvidence(userId, creatives.map((creative) => creative.id)),
  ])
  const vById = new Map(videos.map((v) => [v.id, v]))

  return NextResponse.json({
    campaigns: campaigns.map((camp) => ({
      id: camp.id,
      name: camp.name,
      brief: camp.brief,
      platform: camp.platform,
      createdAt: camp.createdAt.toISOString(),
      creatives: creatives
        .filter((c) => c.campaignId === camp.id)
        .map((c) => {
          const v = c.videoId ? vById.get(c.videoId) : null
          return {
            id: c.id,
            label: c.label,
            hook: c.hook,
            cta: c.cta,
            aspect: c.aspect,
            videoId: c.videoId,
            isWinner: c.isWinner,
            roas: c.roas,
            status: v?.status ?? null,
            url: v?.fileUrl ?? v?.url ?? null,
            thumbnail: v?.thumbnail ?? null,
            approvalStatus: c.approvalStatus,
            rightsStatus: c.rightsStatus,
            revision: c.revision,
            approvedRevision: c.approvedRevision,
            evidence: evidence.get(c.id),
          }
        }),
    })),
  })
}
