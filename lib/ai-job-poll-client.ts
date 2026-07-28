/**
 * Shared client-side poll loop for GET /api/ai/jobs/[videoId] — the same
 * deadline/sleep/fetch/percent loop that had been copy-pasted across the
 * studio panels (extracted once it hit the repo's 3-occurrence rule; the
 * avatar and frontier panels use it now, and the voice-to-video,
 * scene-editor, and ad-studio variants can adopt it with their own
 * interval/deadline settings).
 *
 * Client-only: browser fetch against a relative URL, no server imports.
 */
export interface PollAiJobOptions {
  intervalMs?: number
  deadlineMs?: number
  onProgress?: (percent: number) => void
  /** Thrown when the job reports FAILED/CANCELLED without its own error message. */
  errorFallback?: string
  /** Thrown when the deadline passes without a terminal status. */
  timeoutMessage?: string
}

export interface PollAiJobResult {
  videoUrl: string | null
  /**
   * True when the render finished but the automated quality gate or fact
   * check held it for the owner's review (VideoStatus REVIEW_REQUIRED) —
   * part of the controlled learning system. The video is watchable at
   * reviewPreviewUrl but is NOT a completed deliverable until accepted via
   * PATCH /api/videos/[id]/quality-review.
   */
  requiresReview: boolean
  reviewPreviewUrl: string | null
  qualityGate: unknown
  factCheck: unknown
}

export async function pollAiJob(
  videoId: string,
  {
    intervalMs = 5000,
    deadlineMs = 16 * 60 * 1000,
    onProgress,
    errorFallback = 'Generation failed',
    timeoutMessage = 'Generation timed out',
  }: PollAiJobOptions = {},
): Promise<PollAiJobResult> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const res = await fetch(`/api/ai/jobs/${videoId}`)
    if (!res.ok) continue
    const job = await res.json()
    onProgress?.(job.percent ?? 0)
    if (job.status === 'COMPLETED' && job.videoUrl) {
      return { videoUrl: job.videoUrl, requiresReview: false, reviewPreviewUrl: null, qualityGate: null, factCheck: null }
    }
    // Held for human review — terminal for polling purposes. Without this
    // check, a flagged render would leave the UI spinning until timeout.
    if (job.status === 'REVIEW_REQUIRED' || job.requiresReview) {
      return {
        videoUrl: null,
        requiresReview: true,
        reviewPreviewUrl: job.reviewPreviewUrl ?? null,
        qualityGate: job.qualityGate ?? null,
        factCheck: job.factCheck ?? null,
      }
    }
    // CANCELLED is terminal too — the copy-pasted loops only checked FAILED,
    // leaving a cancelled job spinning until the timeout.
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(job.error || errorFallback)
    }
  }
  throw new Error(timeoutMessage)
}
