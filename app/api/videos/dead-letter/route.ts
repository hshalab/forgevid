import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enqueueJob, type GenerationJobData } from '@/lib/video-queue'

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['replay', 'resolve']),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const jobs = await prisma.generationDeadLetter.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, videoId: true, kind: true, error: true, attempts: true, status: true, replayedAt: true, createdAt: true },
  })
  return NextResponse.json({ jobs })
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid dead-letter action' }, { status: 400 })
  const record = await prisma.generationDeadLetter.findFirst({
    where: { id: parsed.data.id, userId: session.user.id },
  })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.action === 'resolve') {
    await prisma.generationDeadLetter.update({ where: { id: record.id }, data: { status: 'RESOLVED' } })
    return NextResponse.json({ status: 'RESOLVED' })
  }
  let data: GenerationJobData
  try {
    const candidate = JSON.parse(record.jobData)
    if (candidate.userId !== session.user.id || candidate.videoId !== record.videoId || !['generate', 'rerender'].includes(candidate.kind)) {
      throw new Error('Stored job identity mismatch')
    }
    data = candidate as GenerationJobData
  } catch {
    return NextResponse.json({ error: 'Stored job payload is invalid' }, { status: 422 })
  }
  const jobId = await enqueueJob(data)
  if (!jobId) return NextResponse.json({ error: 'Replay queue is unavailable' }, { status: 503 })
  await prisma.generationDeadLetter.update({
    where: { id: record.id },
    data: { status: 'REPLAYED', replayedAt: new Date() },
  })
  return NextResponse.json({ status: 'REPLAYED', jobId })
}
