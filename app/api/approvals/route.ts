import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const creatives = await prisma.adCreative.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const campaignIds = [...new Set(creatives.map((creative) => creative.campaignId))];
  const videoIds = creatives.map((creative) => creative.videoId).filter((id): id is string => Boolean(id));
  const [campaigns, videos] = await Promise.all([
    campaignIds.length
      ? prisma.adCampaign.findMany({
          where: { id: { in: campaignIds }, userId: session.user.id },
          select: { id: true, name: true, brief: true, platform: true },
        })
      : [],
    videoIds.length
      ? prisma.video.findMany({
          where: { id: { in: videoIds }, userId: session.user.id },
          select: { id: true, status: true, fileUrl: true, url: true, thumbnail: true },
        })
      : [],
  ]);
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const videoById = new Map(videos.map((video) => [video.id, video]));

  return NextResponse.json({
    approvals: creatives.map((creative) => {
      const campaign = campaignById.get(creative.campaignId);
      const video = creative.videoId ? videoById.get(creative.videoId) : null;
      return {
        id: creative.id,
        label: creative.label,
        hook: creative.hook,
        cta: creative.cta,
        aspect: creative.aspect,
        approvalStatus: creative.approvalStatus,
        rightsStatus: creative.rightsStatus,
        revision: creative.revision,
        approvedRevision: creative.approvedRevision,
        approvedAt: creative.approvedAt?.toISOString() ?? null,
        reviewNote: creative.reviewNote,
        recommendationReason: creative.recommendationReason,
        expectedResult: creative.expectedResult,
        estimatedCostCents: creative.estimatedCostCents,
        campaign: campaign ?? null,
        video: video
          ? { status: video.status, url: video.fileUrl ?? video.url, thumbnail: video.thumbnail }
          : null,
        publicUrl:
          creative.approvalStatus === 'APPROVED' && creative.approvedRevision === creative.revision
            ? `/l/${creative.id}`
            : null,
      };
    }),
  });
}
