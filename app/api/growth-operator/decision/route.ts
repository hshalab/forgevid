import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRecommendations } from '@/lib/inventory';
import { hasLlmKey, llmProvider } from '@/lib/ai/llm';
import { runGrowthDecision } from '@/lib/growth-operator-run';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!hasLlmKey() || llmProvider() !== 'gemini') {
    return NextResponse.json({ error: 'The Growth Operator requires Gemini to be configured.' }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 });

  const recommendations = await getRecommendations(session.user.id, undefined, 100);
  const opportunity = recommendations.find((item) => item.itemId === itemId);
  if (!opportunity) {
    return NextResponse.json({ error: 'Inventory item not found or no longer active.' }, { status: 404 });
  }
  try {
    const result = await runGrowthDecision(session.user.id, opportunity);
    return NextResponse.json({
      decision: result.decision,
      auditId: result.auditId,
      provider: 'gemini',
      model: result.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini could not create a valid decision.';
    console.error('[growth-operator/decision]', message);
    return NextResponse.json({ error: 'Gemini could not create a valid campaign decision.' }, { status: 502 });
  }
}
