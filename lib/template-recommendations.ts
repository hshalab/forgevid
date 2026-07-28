/**
 * Evidence-based template recommendations — the design-learning layer's
 * first consumer surface. Rules-first and explainable, exactly like
 * lib/provider-router.ts: each template's score comes from its own
 * measured analytics (uses, views→click engagement, ratings, favorites),
 * never from an unexplainable black box, and every recommendation says
 * how much evidence backs it. A template with no evidence gets a neutral
 * prior — new templates aren't buried, they're just not overclaimed.
 */
import { prisma } from './prisma';
import type { TemplateCategory } from '@prisma/client';

export interface TemplateRecommendation {
  templateId: string;
  name: string;
  category: TemplateCategory;
  thumbnail: string;
  aspectRatio: string;
  score: number;
  reason: string;
  evidenceCount: number;
}

const WINDOW_DAYS = 90;

export async function recommendTemplates(
  category?: TemplateCategory,
  limit = 5,
): Promise<TemplateRecommendation[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const templates = await prisma.template.findMany({
    where: {
      isPublic: true,
      moderationStatus: 'approved',
      ...(category ? { category } : {}),
    },
    select: {
      id: true,
      name: true,
      category: true,
      thumbnail: true,
      aspectRatio: true,
      usageCount: true,
      averageRating: true,
      totalRatings: true,
      favoriteCount: true,
      analytics: {
        where: { date: { gte: since } },
        select: { views: true, clicks: true, uses: true },
      },
    },
  });

  return templates
    .map((template) => {
      const views = template.analytics.reduce((sum, row) => sum + row.views, 0);
      const clicks = template.analytics.reduce((sum, row) => sum + row.clicks, 0);
      const uses = template.analytics.reduce((sum, row) => sum + row.uses, 0);
      const evidenceCount = views + uses + template.totalRatings;

      // Engagement: click-through when viewed. Neutral 0.5 prior below 20 views.
      const engagement = views >= 20 ? clicks / views : 0.5;
      // Adoption: recent uses, log-dampened so one viral template doesn't
      // permanently bury everything else.
      const adoption = Math.min(100, Math.log10(1 + uses + template.usageCount) * 40);
      // Satisfaction: the average rating (1-5), neutral 3 below 3 ratings.
      const rating = template.totalRatings >= 3 ? Number(template.averageRating ?? 3) : 3;

      const score = engagement * 100 * 0.3 + adoption * 0.4 + (rating / 5) * 100 * 0.3;

      return {
        templateId: template.id,
        name: template.name,
        category: template.category,
        thumbnail: template.thumbnail,
        aspectRatio: template.aspectRatio,
        score: Number(score.toFixed(1)),
        reason: evidenceCount
          ? `Based on ${uses} recent uses, ${views} views, and ${template.totalRatings} rating${template.totalRatings === 1 ? '' : 's'}`
          : 'No usage evidence yet — neutral prior',
        evidenceCount,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 20)));
}
