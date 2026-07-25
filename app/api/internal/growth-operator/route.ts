import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getRecommendations } from '@/lib/inventory'
import { runGrowthDecision } from '@/lib/growth-operator-run'
import { hasLlmKey, llmProvider } from '@/lib/ai/llm'
import { sendGrowthOperatorEmail } from '@/lib/email'

export const runtime = 'nodejs'

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('x-cron-secret')
  if (!expected || !supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasLlmKey() || llmProvider() !== 'gemini') {
    return NextResponse.json({ error: 'Gemini is not configured' }, { status: 503 })
  }
  const now = new Date()
  const schedules = await prisma.growthOperatorSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: 20,
  })
  const results = []
  for (const schedule of schedules) {
    try {
      const opportunities = await getRecommendations(schedule.userId, undefined, schedule.maxDecisions)
      const decisions = []
      for (const opportunity of opportunities) {
        decisions.push(await runGrowthDecision(schedule.userId, opportunity))
      }
      if (decisions.length > 0) {
        await prisma.notification.create({
          data: {
            userId: schedule.userId,
            type: 'INFO',
            title: `${decisions.length} Growth Operator recommendation${decisions.length === 1 ? '' : 's'} ready`,
            message: 'Review the evidence and explicitly approve any campaign generation. Nothing was published or sent.',
            data: JSON.stringify({ auditIds: decisions.map((decision) => decision.auditId), href: '/dashboard/recommendations' }),
          },
        })
        if (schedule.emailEnabled) {
          const user = await prisma.user.findUnique({
            where: { id: schedule.userId },
            select: { email: true, name: true },
          })
          if (user) await sendGrowthOperatorEmail(user.email, user.name || 'Creator', decisions.length)
        }
      }
      const intervalDays = schedule.cadence === 'weekly' ? 7 : 1
      const nextRunAt = new Date(now.getTime() + intervalDays * 86_400_000)
      await prisma.growthOperatorSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt, lastError: null },
      })
      results.push({ userId: schedule.userId, decisions: decisions.length, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Scheduled run failed'
      await prisma.growthOperatorSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + 3_600_000), lastError: message },
      })
      results.push({ userId: schedule.userId, decisions: 0, ok: false })
    }
  }
  return NextResponse.json({ processed: results.length, results })
}
