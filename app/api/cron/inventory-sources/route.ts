import { NextRequest, NextResponse } from 'next/server'
import { runInventorySource } from '@/lib/inventory-source-runner'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const due = await prisma.inventorySource.findMany({
    where: {
      enabled: true,
      scheduleEnabled: true,
      nextRunAt: { lte: now },
      OR: [{ authorizationExpiresAt: null }, { authorizationExpiresAt: { gt: now } }],
    },
    take: 20,
  })
  const results = []
  for (const source of due) {
    const nextRunAt = new Date(now.getTime() + (source.cadence === 'weekly' ? 7 : 1) * 86_400_000)
    const claimed = await prisma.inventorySource.updateMany({
      where: { id: source.id, nextRunAt: source.nextRunAt },
      data: { nextRunAt },
    })
    if (!claimed.count) continue
    try {
      results.push({ sourceId: source.id, ...(await runInventorySource(source)) })
    } catch (error) {
      results.push({ sourceId: source.id, status: 'FAILED', error: error instanceof Error ? error.message : 'Import failed' })
    }
  }
  return NextResponse.json({ processed: results.length, results })
}
