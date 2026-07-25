import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const schema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(['daily', 'weekly']),
  emailEnabled: z.boolean(),
  maxDecisions: z.number().int().min(1).max(3),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const schedule = await prisma.growthOperatorSchedule.findUnique({ where: { userId: session.user.id } })
  return NextResponse.json({
    schedule: schedule ?? { enabled: false, cadence: 'daily', emailEnabled: true, maxDecisions: 1 },
  })
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid schedule settings' }, { status: 400 })
  const now = new Date()
  const schedule = await prisma.growthOperatorSchedule.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...parsed.data, nextRunAt: parsed.data.enabled ? now : null },
    update: { ...parsed.data, nextRunAt: parsed.data.enabled ? now : null, lastError: null },
  })
  return NextResponse.json({ schedule })
}
