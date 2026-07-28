import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/rbac'
import { transitionOptimization } from '@/lib/optimization-registry'
import { appendEvidence } from '@/lib/evidence-ledger'

/**
 * The optimization registry's control surface — the human-approval half of
 * the controlled learning system's rollout loop. Artifacts (a prompt
 * revision, a config change) are created as DRAFTs here, then walked
 * through approve → canary (1-50% stable-bucket) → activate (supersedes
 * the prior ACTIVE version) or rollback, via lib/optimization-registry.ts.
 * Nothing self-activates: every transition is an explicit admin action,
 * and each one is appended to the evidence chain.
 */

const createSchema = z.object({
  kind: z.string().min(1).max(40),
  key: z.string().min(1).max(80),
  config: z.record(z.string(), z.unknown()),
  offlineScore: z.number().min(0).max(100).optional(),
})

const transitionSchema = z.object({
  artifactId: z.string().min(1),
  action: z.enum(['approve', 'canary', 'activate', 'rollback']),
  canaryPercent: z.number().int().min(1).max(50).optional(),
  reason: z.string().max(500).optional(),
})

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const artifacts = await prisma.optimizationArtifact.findMany({
    orderBy: [{ kind: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    take: 200,
  })
  return NextResponse.json({ artifacts })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
  }

  const latest = await prisma.optimizationArtifact.findFirst({
    where: { kind: parsed.data.kind, key: parsed.data.key },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const artifact = await prisma.optimizationArtifact.create({
    data: {
      kind: parsed.data.kind,
      key: parsed.data.key,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      config: parsed.data.config as never,
      offlineScore: parsed.data.offlineScore ?? null,
    },
  })
  return NextResponse.json({ artifact }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const parsed = transitionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
  }

  try {
    const artifact = await transitionOptimization({ ...parsed.data, actorUserId: admin.id })
    await appendEvidence({
      kind: 'optimization.transition',
      entityType: 'OptimizationArtifact',
      entityId: artifact.id,
      actorUserId: admin.id,
      payload: {
        action: parsed.data.action,
        kind: artifact.kind,
        key: artifact.key,
        version: artifact.version,
        status: artifact.status,
        canaryPercent: artifact.canaryPercent,
        reason: parsed.data.reason ?? null,
      },
    })
    return NextResponse.json({ artifact })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transition failed'
    const status = message.includes('not found') ? 404 : 409
    return NextResponse.json({ error: message }, { status })
  }
}
