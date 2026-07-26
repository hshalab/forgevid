import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const schema = z.object({
  agingWeight: z.number().int().min(0).max(10),
  missingVideoWeight: z.number().int().min(0).max(100),
  priceChangeWeight: z.number().int().min(0).max(100),
  newArrivalWeight: z.number().int().min(0).max(100),
  seasonalWeight: z.number().int().min(0).max(100),
  seasonalMonths: z.array(z.number().int().min(1).max(12)).max(12),
  revenueAtRiskMethod: z.enum(['none', 'price_text_proxy', 'manual_priority']),
  revenueAtRiskWeight: z.number().int().min(0).max(100),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const settings = await prisma.growthScoringSettings.findUnique({ where: { userId: session.user.id } })
  return NextResponse.json({ settings: settings ? {
    ...settings,
    seasonalMonths: JSON.parse(settings.seasonalMonths || '[]'),
  } : {
    agingWeight: 1, missingVideoWeight: 30, priceChangeWeight: 25,
    newArrivalWeight: 15, seasonalWeight: 0, seasonalMonths: [],
    revenueAtRiskMethod: 'none', revenueAtRiskWeight: 0,
  } })
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid scoring settings' }, { status: 400 })
  const settings = await prisma.growthScoringSettings.upsert({
    where: { userId: session.user.id },
    update: { ...parsed.data, seasonalMonths: JSON.stringify(parsed.data.seasonalMonths) },
    create: { ...parsed.data, seasonalMonths: JSON.stringify(parsed.data.seasonalMonths), userId: session.user.id },
  })
  return NextResponse.json({ settings })
}
