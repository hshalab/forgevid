import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRecommendations, type Vertical } from '@/lib/inventory';

const VALID_VERTICALS: Vertical[] = ['auto', 'realestate', 'ecom'];

/**
 * GET /api/inventory/recommendations?vertical=auto
 *
 * "Which item should I make a video for next, and why" — scored from this
 * business's own imported inventory history (lib/inventory.ts). Empty until
 * at least one batch import has run with a vertical set, since scoring
 * needs snapshot history to compare against.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const verticalParam = req.nextUrl.searchParams.get('vertical');
  const vertical = verticalParam && VALID_VERTICALS.includes(verticalParam as Vertical)
    ? (verticalParam as Vertical)
    : undefined;

  const recommendations = await getRecommendations(session.user.id, vertical);
  return NextResponse.json({ recommendations });
}
