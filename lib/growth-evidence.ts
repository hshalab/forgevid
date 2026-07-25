import { prisma } from '@/lib/prisma'
import { classifyEvidence, type ExperimentEvidence } from '@/lib/growth-experiments'

export async function getCreativeEvidence(userId: string, creativeIds: string[]) {
  if (creativeIds.length === 0) return new Map<string, ExperimentEvidence & { strength: string }>()
  const [events, conversions] = await Promise.all([
    prisma.creativeEvent.groupBy({
      by: ['creativeId', 'kind'],
      where: { creativeId: { in: creativeIds } },
      _count: { _all: true },
    }),
    prisma.growthConversion.groupBy({
      by: ['creativeId'],
      where: { userId, creativeId: { in: creativeIds } },
      _count: { _all: true },
      _sum: { revenueCents: true },
    }),
  ])
  const map = new Map<string, ExperimentEvidence & { strength: string }>()
  for (const creativeId of creativeIds) {
    const evidence = {
      views: events.find((event) => event.creativeId === creativeId && event.kind === 'view')?._count._all ?? 0,
      leads: events.find((event) => event.creativeId === creativeId && event.kind === 'lead_submitted')?._count._all ?? 0,
      downstreamConversions: conversions.find((item) => item.creativeId === creativeId)?._count._all ?? 0,
      revenueCents: conversions.find((item) => item.creativeId === creativeId)?._sum.revenueCents ?? 0,
    }
    map.set(creativeId, { ...evidence, strength: classifyEvidence(evidence) })
  }
  return map
}
