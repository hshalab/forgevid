import { prisma } from '@/lib/prisma'
import type { Opportunity } from '@/lib/inventory'
import { buildGrowthDecisionPrompt, parseGrowthDecision } from '@/lib/growth-decision'
import { evidenceLabel } from '@/lib/growth-experiments'
import { llm, llmModel } from '@/lib/ai/llm'

export async function runGrowthDecision(userId: string, opportunity: Opportunity) {
  const prior = await prisma.aIGeneration.findMany({
    where: { userId, type: 'GROWTH_DECISION', status: 'COMPLETED' },
    select: { id: true, result: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const decisionIds = prior.filter((record) => {
    try { return JSON.parse(record.result || '{}').inventoryItemId === opportunity.itemId } catch { return false }
  }).map((record) => record.id)

  let learningEvidence = ''
  if (decisionIds.length > 0) {
    const campaigns = await prisma.adCampaign.findMany({
      where: { userId, aiDecisionId: { in: decisionIds } },
      select: { id: true },
    })
    const creatives = campaigns.length ? await prisma.adCreative.findMany({
      where: { userId, campaignId: { in: campaigns.map((campaign) => campaign.id) } },
      select: { id: true },
    }) : []
    const ids = creatives.map((creative) => creative.id)
    if (ids.length) {
      const [events, conversions] = await Promise.all([
        prisma.creativeEvent.groupBy({
          by: ['kind'], where: { creativeId: { in: ids } }, _count: { _all: true },
        }),
        prisma.growthConversion.findMany({
          where: { userId, creativeId: { in: ids } }, select: { revenueCents: true },
        }),
      ])
      const counts = Object.fromEntries(events.map((event) => [event.kind, event._count._all]))
      learningEvidence = evidenceLabel({
        views: counts.view ?? 0,
        leads: counts.lead_submitted ?? 0,
        downstreamConversions: conversions.length,
        revenueCents: conversions.reduce((sum, conversion) => sum + (conversion.revenueCents ?? 0), 0),
      })
    }
  }
  const prompt = [
    buildGrowthDecisionPrompt(opportunity),
    learningEvidence
      ? `Prior measured campaign evidence for this exact inventory item: ${learningEvidence}. Treat INSUFFICIENT and DIRECTIONAL results conservatively; never claim causality.`
      : 'No prior measured campaign evidence exists for this item. Propose an exploration test; do not claim a winner.',
  ].join('\n')
  const audit = await prisma.aIGeneration.create({
    data: { userId, type: 'GROWTH_DECISION', prompt, status: 'PROCESSING' },
    select: { id: true },
  })
  try {
    const completion = await llm.chat.completions.create({
      model: llmModel('standard'),
      messages: [
        { role: 'system', content: 'Return a conservative, evidence-grounded JSON campaign decision. Never include markdown.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    })
    const decision = parseGrowthDecision(completion.choices[0]?.message?.content || '', opportunity.itemId)
    await prisma.aIGeneration.update({
      where: { id: audit.id },
      data: { result: JSON.stringify(decision), status: 'COMPLETED', tokensUsed: completion.usage?.total_tokens ?? 0 },
    })
    return { decision, auditId: audit.id, model: llmModel('standard') }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini could not create a valid decision.'
    await prisma.aIGeneration.update({
      where: { id: audit.id },
      data: { status: 'FAILED', result: JSON.stringify({ error: message }) },
    })
    throw error
  }
}
