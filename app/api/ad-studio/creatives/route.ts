import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCreativeEvidence } from '@/lib/growth-evidence'

export const runtime = 'nodejs'

// GET [?winners=1] — the user's creatives (optionally only winners), ranked by
// winner + ROAS, joined to the live video + originating campaign (for the
// "make more like this" loop).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = session.user.id
  const winnersOnly = new URL(req.url).searchParams.get('winners') === '1'

  const creatives = await prisma.adCreative.findMany({
    where: { userId, ...(winnersOnly ? { isWinner: true } : {}) },
    orderBy: [{ isWinner: 'desc' }, { roas: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })

  const videoIds = creatives.map((c) => c.videoId).filter((v): v is string => !!v)
  const campaignIds = Array.from(new Set(creatives.map((c) => c.campaignId)))
  const [videos, campaigns, evidence] = await Promise.all([
    videoIds.length
      ? prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, status: true, url: true, fileUrl: true, thumbnail: true } })
      : Promise.resolve([]),
    campaignIds.length
      ? prisma.adCampaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true, brief: true, platform: true } })
      : Promise.resolve([]),
    getCreativeEvidence(userId, creatives.map((creative) => creative.id)),
  ])
  const vById = new Map(videos.map((v) => [v.id, v]))
  const cById = new Map(campaigns.map((c) => [c.id, c]))

  return NextResponse.json({
    creatives: creatives.map((c) => {
      const v = c.videoId ? vById.get(c.videoId) : null
      const camp = cById.get(c.campaignId)
      return {
        id: c.id,
        label: c.label,
        hook: c.hook,
        cta: c.cta,
        aspect: c.aspect,
        platform: c.platform,
        isWinner: c.isWinner,
        roas: c.roas,
        notes: c.notes,
        videoId: c.videoId,
        status: v?.status ?? null,
        url: v?.fileUrl ?? v?.url ?? null,
        thumbnail: v?.thumbnail ?? null,
        campaignId: c.campaignId,
        campaignName: camp?.name ?? null,
        brief: camp?.brief ?? null,
        evidence: evidence.get(c.id),
      }
    }),
  })
}
