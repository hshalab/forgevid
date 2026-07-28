import crypto from 'crypto';
import { prisma } from './prisma';

function stableBucket(userId: string, artifactId: string): number {
  const hex = crypto.createHash('sha256').update(`${userId}:${artifactId}`).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

export async function resolveOptimization(kind: string, key: string, userId: string) {
  const candidates = await prisma.optimizationArtifact.findMany({
    where: { kind, key, status: { in: ['ACTIVE', 'CANARY'] } },
    orderBy: { version: 'desc' },
  });
  const active = candidates.find((candidate) => candidate.status === 'ACTIVE') ?? null;
  const canary = candidates.find((candidate) => candidate.status === 'CANARY') ?? null;
  if (!canary || canary.canaryPercent <= 0) return active;

  const bucket = stableBucket(userId, canary.id);
  await prisma.optimizationAssignment.upsert({
    where: { artifactId_userId: { artifactId: canary.id, userId } },
    create: { artifactId: canary.id, userId, bucket },
    update: { bucket },
  });
  return bucket < canary.canaryPercent ? canary : active;
}

export async function transitionOptimization(input: {
  artifactId: string;
  actorUserId: string;
  action: 'approve' | 'canary' | 'activate' | 'rollback';
  canaryPercent?: number;
  reason?: string;
}) {
  const artifact = await prisma.optimizationArtifact.findUnique({ where: { id: input.artifactId } });
  if (!artifact) throw new Error('Optimization artifact not found');
  if (input.action === 'approve') {
    // Only a DRAFT can be approved — "approving" an ACTIVE artifact would
    // silently demote it out of service.
    if (artifact.status !== 'DRAFT') throw new Error('Only a draft can be approved');
    return prisma.optimizationArtifact.update({
      where: { id: artifact.id },
      data: { status: 'APPROVED', approvedByUserId: input.actorUserId, approvedAt: new Date() },
    });
  }
  if (input.action === 'canary') {
    if (artifact.status !== 'APPROVED' && artifact.status !== 'CANARY') throw new Error('Approve before canary');
    const percent = Math.max(1, Math.min(50, input.canaryPercent ?? 5));
    return prisma.optimizationArtifact.update({
      where: { id: artifact.id },
      data: { status: 'CANARY', canaryPercent: percent },
    });
  }
  if (input.action === 'activate') {
    // The staged rollout is the whole point: approve -> canary -> activate.
    // Activating a DRAFT (or resurrecting a ROLLED_BACK artifact) skips the
    // human-approval and canary evidence this registry exists to enforce.
    if (artifact.status !== 'APPROVED' && artifact.status !== 'CANARY') {
      throw new Error('Approve (and optionally canary) before activating');
    }
    await prisma.optimizationArtifact.updateMany({
      where: { kind: artifact.kind, key: artifact.key, status: 'ACTIVE' },
      data: { status: 'ROLLED_BACK', rolledBackAt: new Date(), rollbackReason: `Superseded by v${artifact.version}` },
    });
    return prisma.optimizationArtifact.update({
      where: { id: artifact.id },
      data: { status: 'ACTIVE', canaryPercent: 0, activatedAt: new Date() },
    });
  }
  return prisma.optimizationArtifact.update({
    where: { id: artifact.id },
    data: {
      status: 'ROLLED_BACK',
      canaryPercent: 0,
      rolledBackAt: new Date(),
      rollbackReason: input.reason?.slice(0, 500) || 'Manual rollback',
    },
  });
}
