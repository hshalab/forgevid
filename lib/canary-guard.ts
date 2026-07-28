/**
 * The automatic-rollback half of the optimization registry: canaries were
 * previously rolled back only by an explicit admin action; this guard
 * compares each CANARY artifact's real evaluation outcomes against the
 * baseline and rolls back automatically when quality measurably declines.
 *
 * Deliberately conservative, deterministic rules (no significance-test
 * theater on tiny samples):
 *  - needs >= MIN_SAMPLES evaluations on BOTH arms within the window;
 *  - rolls back when the canary's average quality score drops more than
 *    QUALITY_DROP points below baseline, OR its quality-gate pass rate
 *    drops more than PASS_RATE_DROP below baseline;
 *  - otherwise leaves the canary running and reports what it saw.
 *
 * Every automatic rollback is appended to the evidence chain — the same
 * auditability as a manual admin transition.
 */
import { prisma } from './prisma';
import { transitionOptimization } from './optimization-registry';
import { appendEvidence } from './evidence-ledger';

const WINDOW_DAYS = 7;
const MIN_SAMPLES = 10;
const QUALITY_DROP = 15;
const PASS_RATE_DROP = 0.2;

interface ArmStats {
  count: number;
  avgQuality: number | null;
  passRate: number | null;
}

function armStats(rows: Array<{ qualityScore: number | null; qualityPassed: boolean | null }>): ArmStats {
  const qualityValues = rows.map((row) => row.qualityScore).filter((value): value is number => value != null);
  const passValues = rows.map((row) => row.qualityPassed).filter((value): value is boolean => value != null);
  return {
    count: rows.length,
    avgQuality: qualityValues.length
      ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length
      : null,
    passRate: passValues.length ? passValues.filter(Boolean).length / passValues.length : null,
  };
}

export interface CanaryVerdict {
  artifactId: string;
  kind: string;
  key: string;
  version: number;
  action: 'kept' | 'rolled_back' | 'insufficient_evidence';
  canary: ArmStats;
  baseline: ArmStats;
  reason: string;
}

/** Evaluate every live canary once; roll back the ones that regressed. */
export async function evaluateCanaries(): Promise<CanaryVerdict[]> {
  // SCOPE: only the ('prompt','scene-planner') artifact — the one artifact
  // whose version the pipeline actually records on evaluations. Guarding
  // other kinds by bare version-string match would compare unrelated rows
  // (a 'template' v3 against scene-planner v3 evaluations) and auto-roll
  // them back on noise. Widen only when evaluations carry per-artifact
  // labels.
  const canaries = await prisma.optimizationArtifact.findMany({
    where: { status: 'CANARY', kind: 'prompt', key: 'scene-planner' },
    select: { id: true, kind: true, key: true, version: true, updatedAt: true },
  });

  const verdicts: CanaryVerdict[] = [];
  for (const canary of canaries) {
    // Baseline = the currently ACTIVE version of the same kind+key, or the
    // 'unversioned' label the pipeline records when no artifact resolved
    // (i.e. pre-registry renders) when nothing was ever activated.
    const active = await prisma.optimizationArtifact.findFirst({
      where: { kind: canary.kind, key: canary.key, status: 'ACTIVE' },
      select: { version: true },
    });
    const canaryVersion = `v${canary.version}`;
    const baselineVersion = active ? `v${active.version}` : 'unversioned';

    if (canaryVersion === baselineVersion) {
      verdicts.push({
        artifactId: canary.id,
        kind: canary.kind,
        key: canary.key,
        version: canary.version,
        action: 'insufficient_evidence',
        canary: { count: 0, avgQuality: null, passRate: null },
        baseline: { count: 0, avgQuality: null, passRate: null },
        reason: 'Canary and baseline resolve to the same version label — no comparison possible',
      });
      continue;
    }

    // Window floor at the canary's last transition: comparing against rows
    // from before the canary even started would bias with seasonality.
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
    const since = canary.updatedAt > windowStart ? canary.updatedAt : windowStart;

    const [canaryRows, baselineRows] = await Promise.all([
      prisma.generationEvaluation.findMany({
        where: { promptVersion: canaryVersion, createdAt: { gte: since } },
        select: { qualityScore: true, qualityPassed: true },
      }),
      prisma.generationEvaluation.findMany({
        where: { promptVersion: baselineVersion, createdAt: { gte: since } },
        select: { qualityScore: true, qualityPassed: true },
      }),
    ]);

    const canaryStats = armStats(canaryRows);
    const baselineStats = armStats(baselineRows);

    if (canaryStats.count < MIN_SAMPLES || baselineStats.count < MIN_SAMPLES) {
      verdicts.push({
        artifactId: canary.id,
        kind: canary.kind,
        key: canary.key,
        version: canary.version,
        action: 'insufficient_evidence',
        canary: canaryStats,
        baseline: baselineStats,
        reason: `Need ${MIN_SAMPLES}+ evaluations on both arms (canary ${canaryStats.count}, baseline ${baselineStats.count})`,
      });
      continue;
    }

    const qualityRegressed =
      canaryStats.avgQuality != null &&
      baselineStats.avgQuality != null &&
      canaryStats.avgQuality < baselineStats.avgQuality - QUALITY_DROP;
    const passRateRegressed =
      canaryStats.passRate != null &&
      baselineStats.passRate != null &&
      canaryStats.passRate < baselineStats.passRate - PASS_RATE_DROP;

    if (qualityRegressed || passRateRegressed) {
      const reason =
        `Auto-rollback: canary v${canary.version} vs baseline ${baselineVersion} over ${WINDOW_DAYS}d — ` +
        `avg quality ${canaryStats.avgQuality?.toFixed(1)} vs ${baselineStats.avgQuality?.toFixed(1)}, ` +
        `pass rate ${canaryStats.passRate?.toFixed(2)} vs ${baselineStats.passRate?.toFixed(2)}`;
      await transitionOptimization({
        artifactId: canary.id,
        actorUserId: 'system:canary-guard',
        action: 'rollback',
        reason,
      });
      await appendEvidence({
        kind: 'optimization.auto_rollback',
        entityType: 'OptimizationArtifact',
        entityId: canary.id,
        payload: {
          kind: canary.kind,
          key: canary.key,
          version: canary.version,
          baselineVersion,
          canary: canaryStats,
          baseline: baselineStats,
          reason,
        },
      });
      verdicts.push({
        artifactId: canary.id,
        kind: canary.kind,
        key: canary.key,
        version: canary.version,
        action: 'rolled_back',
        canary: canaryStats,
        baseline: baselineStats,
        reason,
      });
    } else {
      verdicts.push({
        artifactId: canary.id,
        kind: canary.kind,
        key: canary.key,
        version: canary.version,
        action: 'kept',
        canary: canaryStats,
        baseline: baselineStats,
        reason: 'No measurable regression',
      });
    }
  }
  return verdicts;
}
