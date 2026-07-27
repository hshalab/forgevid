import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PLAN_QUOTAS } from '@/lib/quota';
import { getUserPlan } from '@/lib/plan';

/**
 * The signed-in user's REAL analytics — only metrics we actually track.
 *
 * Everything here is derived from the user's own Video rows. Untracked things
 * the old mock page invented (exports, storage GB, engagement, watch time,
 * template usage) are deliberately left out rather than faked.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const userId = session.user.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Last 6 calendar months, oldest first.
    const monthRanges = Array.from({ length: 6 }, (_, k) => {
      const i = 5 - k;
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      return { label: start.toLocaleString('en-US', { month: 'short' }), start, end };
    });

    const [total, thisMonth, completed, inProgress, failed, durationAgg, plan, creatives, assumptions, conversions, marketingSpend, ...monthlyCounts] =
      await Promise.all([
        prisma.video.count({ where: { userId } }),
        prisma.video.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
        prisma.video.count({ where: { userId, status: 'COMPLETED' } }),
        prisma.video.count({ where: { userId, status: { in: ['PROCESSING', 'QUEUED'] } } }),
        prisma.video.count({ where: { userId, status: 'FAILED' } }),
        prisma.video.aggregate({ where: { userId }, _sum: { duration: true }, _avg: { duration: true } }),
        getUserPlan(userId),
        prisma.adCreative.findMany({
          where: { userId },
          select: { id: true, label: true, campaignId: true, roas: true, isWinner: true, totalSpendCents: true },
        }),
        prisma.impactAssumption.findUnique({ where: { userId } }),
        prisma.growthConversion.findMany({
          where: { userId },
          orderBy: { occurredAt: 'desc' },
          take: 100,
        }),
        prisma.operatingCost.aggregate({
          where: { userId, category: 'marketing_spend' },
          _sum: { amountCents: true },
        }),
        ...monthRanges.map((r) =>
          prisma.video.count({ where: { userId, createdAt: { gte: r.start, lt: r.end } } }),
        ),
      ]);

    const videoLimit = PLAN_QUOTAS[plan]?.videosPerMonth ?? PLAN_QUOTAS.free.videosPerMonth;
    const totalSeconds = durationAgg._sum.duration ?? 0;
    const minutesPerTraditionalVideo = assumptions?.minutesPerTraditionalVideo ?? 120;
    const agencyCostPerVideoCents = assumptions?.agencyCostPerVideoCents ?? 50_000;
    const estimatedMinutesSaved = completed * minutesPerTraditionalVideo;
    const estimatedCostSavedUsd = (completed * agencyCostPerVideoCents) / 100;
    const creativeIds = creatives.map((creative) => creative.id);
    const eventGroups = creativeIds.length
      ? await prisma.creativeEvent.groupBy({
          by: ['kind'],
          where: { creativeId: { in: creativeIds } },
          _count: { _all: true },
        })
      : [];
    const eventCounts = Object.fromEntries(eventGroups.map((group) => [group.kind, group._count._all]));
    const attributedRevenueCents = conversions.reduce((sum, conversion) => sum + (conversion.revenueCents ?? 0), 0);
    const leadCount = eventCounts.lead_submitted ?? 0;
    const viewCount = eventCounts.view ?? 0;
    const marketingSpendCents = marketingSpend._sum.amountCents ?? 0;

    return NextResponse.json({
      summary: {
        total,
        thisMonth,
        completed,
        inProgress,
        failed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalMinutes: Math.round(totalSeconds / 60),
        avgSeconds: Math.round(durationAgg._avg.duration ?? 0),
      },
      usage: { plan, thisMonth, videoLimit },
      value: {
        completedVideos: completed,
        estimatedMinutesSaved,
        estimatedHoursSaved: Math.round((estimatedMinutesSaved / 60) * 10) / 10,
        estimatedCostSavedUsd,
        assumptions: {
          minutesPerTraditionalVideo,
          agencyCostPerVideoUsd: agencyCostPerVideoCents / 100,
          label: 'Illustrative estimate using your saved assumptions; not guaranteed results',
        },
      },
      impact: {
        creatives,
        landingViews: viewCount,
        capturedLeads: leadCount,
        conversionRatePct: viewCount > 0 ? Math.round((leadCount / viewCount) * 1000) / 10 : 0,
        downstreamConversions: conversions.length,
        qualifiedLeads: conversions.filter((conversion) => conversion.kind === 'qualified_lead').length,
        appointments: conversions.filter((conversion) => conversion.kind === 'appointment').length,
        sales: conversions.filter((conversion) => conversion.kind === 'sale').length,
        retained: conversions.filter((conversion) => conversion.kind === 'retained').length,
        attributedRevenueCents,
        currency: conversions[0]?.currency ?? 'usd',
        marketingSpendCents,
        costPerLeadCents: leadCount > 0 ? Math.round(marketingSpendCents / leadCount) : null,
        recentConversions: conversions,
      },
      monthly: monthRanges.map((r, i) => ({ month: r.label, videos: monthlyCounts[i] })),
    });
  } catch (error) {
    console.error('[user/analytics] failed:', error);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
