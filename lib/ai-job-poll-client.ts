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

export async function pollAiJob(
  videoId: string,
  {
    intervalMs = 5000,
    deadlineMs = 16 * 60 * 1000,
    onProgress,
    errorFallback = 'Generation failed',
    timeoutMessage = 'Generation timed out',
  }: PollAiJobOptions = {},
): Promise<{ videoUrl: string }> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const res = await fetch(`/api/ai/jobs/${videoId}`)
    if (!res.ok) continue
    const job = await res.json()
    onProgress?.(job.percent ?? 0)
    if (job.status === 'COMPLETED' && job.videoUrl) {
      return { videoUrl: job.videoUrl }
    }
    // CANCELLED is terminal too — the copy-pasted loops only checked FAILED,
    // leaving a cancelled job spinning until the timeout.
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(job.error || errorFallback)
    }
  }
  throw new Error(timeoutMessage)
}
