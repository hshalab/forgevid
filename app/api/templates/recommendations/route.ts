import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { recommendTemplates } from '@/lib/template-recommendations';
import type { TemplateCategory } from '@prisma/client';

const CATEGORIES = new Set([
  'BUSINESS', 'SOCIAL', 'EDUCATIONAL', 'MARKETING', 'ENTERTAINMENT', 'PRESENTATION',
]);

/**
 * GET /api/templates/recommendations?category=AUTOMOTIVE — evidence-based
 * template ranking for a vertical (lib/template-recommendations.ts).
 * Explainable: every row carries its reason and evidence count.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const raw = request.nextUrl.searchParams.get('category')?.toUpperCase();
  const category = raw && CATEGORIES.has(raw) ? (raw as TemplateCategory) : undefined;
  const recommendations = await recommendTemplates(category, 5);
  return NextResponse.json({ recommendations, category: category ?? null });
}
