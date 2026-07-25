import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getRecommendations } from '@/lib/inventory';
import { buildGrowthDecisionPrompt, parseGrowthDecision } from '@/lib/growth-decision';
import { hasLlmKey, llm, llmModel, llmProvider } from '@/lib/ai/llm';

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
  const prompt = buildGrowthDecisionPrompt(opportunity);
  const audit = await prisma.aIGeneration.create({
    data: {
      userId: session.user.id,
      type: 'GROWTH_DECISION',
      prompt,
      status: 'PROCESSING',
    },
    select: { id: true },
  });

  try {
    const completion = await llm.chat.completions.create({
      model: llmModel('standard'),
      messages: [
        {
          role: 'system',
          content: 'Return a conservative, evidence-grounded JSON campaign decision. Never include markdown.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });
    const raw = completion.choices[0]?.message?.content || '';
    const decision = parseGrowthDecision(raw, itemId);
    await prisma.aIGeneration.update({
      where: { id: audit.id },
      data: {
        result: JSON.stringify(decision),
        status: 'COMPLETED',
        tokensUsed: completion.usage?.total_tokens ?? 0,
      },
    });
    return NextResponse.json({
      decision,
      auditId: audit.id,
      provider: 'gemini',
      model: llmModel('standard'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini could not create a valid decision.';
    await prisma.aIGeneration.update({
      where: { id: audit.id },
      data: { status: 'FAILED', result: JSON.stringify({ error: message }) },
    });
    console.error('[growth-operator/decision]', message);
    return NextResponse.json({ error: 'Gemini could not create a valid campaign decision.' }, { status: 502 });
  }
}
