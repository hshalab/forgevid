/**
 * Shared poll-to-completion loop for a Video backed by an external provider
 * job (HeyGen avatar render, HeyGen video-translate/dub, ...): poll until a
 * terminal status, update the Video row, book the real cost on success, and
 * refund quota/purchased credits on failure. Extracted after the avatar and
 * dub routes' poll loops turned out to be ~90% identical — including the
 * refund/credit logic, where a missed parallel edit would be a real
 * financial bug, not just duplicated shape.
 *
 * Relative imports only — reachable from the worker process.
 */
import { prisma } from './prisma';
import { setStage } from './generation-pipeline';
import { refundGenerationUsage } from './quota';
import { refundCreditForVideo } from './credits';
import { estimateGenerationCost, recordGenerationCost, type CostInputs } from './cost-ledger';

export interface ProviderJobStatus {
  /** 'completed' and 'failed' are terminal; anything else means still processing. */
  status: string;
  videoUrl: string | null;
  error: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_DEADLINE_MS = 15 * 60 * 1000;

export async function pollProviderJobToCompletion<S extends ProviderJobStatus>(args: {
  videoId: string;
  userId: string;
  providerName: string;
  /** Query the provider for this job's current status. */
  checkStatus: () => Promise<S>;
  /**
   * What to book in the cost ledger on success, given the COMPLETED status —
   * a function (not a static value) so a provider that reports its own
   * actual output length (e.g. video-translate's durationSeconds) can bill
   * the real number instead of the pre-flight estimate.
   */
  successCost: (status: S) => CostInputs;
  /** The AIGeneration row's `prompt` field, for both success and failure. */
  prompt: string;
  pollIntervalMs?: number;
  pollDeadlineMs?: number;
}): Promise<void> {
  const { videoId, userId, providerName, checkStatus, successCost, prompt } = args;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (args.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS);

  try {
    await prisma.video.update({ where: { id: videoId }, data: { status: 'PROCESSING' } });
    await setStage(videoId, 'assembling');

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const status = await checkStatus();

      if (status.status === 'completed' && status.videoUrl) {
        await prisma.video.update({
          where: { id: videoId },
          data: { status: 'COMPLETED', url: status.videoUrl, fileUrl: status.videoUrl },
        });
        await setStage(videoId, 'done', { videoUrl: status.videoUrl, provider: providerName });
        await recordGenerationCost({
          userId,
          videoId,
          prompt,
          succeeded: true,
          breakdown: estimateGenerationCost(successCost(status)),
        });
        return;
      }
      if (status.status === 'failed') {
        throw new Error(status.error ?? `${providerName} job failed`);
      }
    }
    throw new Error(`${providerName} job timed out after ${Math.round((args.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS) / 60_000)} minutes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${providerName} job failed`;
    await prisma.video.update({ where: { id: videoId }, data: { status: 'FAILED' } }).catch(() => {});
    await setStage(videoId, 'failed', { error: message }).catch(() => {});
    // A failed provider job must not silently eat quota or purchased
    // credits — give both back, same as generation-pipeline.ts's
    // runGeneration does for the standard ffmpeg pipeline (a provider-job
    // route has its own failure path since it polls a provider instead of
    // running a local render).
    await refundGenerationUsage(videoId).catch(() => {});
    await refundCreditForVideo(videoId).catch(() => {});
    await recordGenerationCost({
      userId,
      videoId,
      prompt,
      succeeded: false,
      breakdown: estimateGenerationCost({}),
    }).catch(() => {});
  }
}
