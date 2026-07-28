import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Generation job status.
 *
 * GET /api/ai/jobs/[videoId] — returns the current stage/percent for a
 * generation, read from the Video row (single source of truth for both the
 * BullMQ-worker and inline execution paths). The client polls this to drive a
 * real progress bar instead of a fake timer.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const video = await prisma.video.findUnique({
    where: { id: params.videoId },
    select: {
      id: true,
      userId: true,
      status: true,
      url: true,
      fileUrl: true,
      thumbnail: true,
      duration: true,
      metadata: true,
    },
  });

  if (!video || video.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let meta: any = {};
  try {
    meta = video.metadata ? JSON.parse(video.metadata) : {};
  } catch {
    meta = {};
  }
  const generation: any = meta.generation ?? null;

  const done = video.status === 'COMPLETED';
  const requiresReview = video.status === 'REVIEW_REQUIRED';
  const videoUrl = video.fileUrl || video.url || generation?.videoUrl || null;

  return NextResponse.json({
    videoId: video.id,
    status: video.status,
    stage: generation?.stage ?? (done ? 'done' : requiresReview ? 'review_required' : 'queued'),
    percent: typeof generation?.percent === 'number' ? generation.percent : done || requiresReview ? 100 : 0,
    videoUrl: done ? videoUrl : null,
    reviewPreviewUrl: requiresReview ? videoUrl : null,
    requiresReview,
    // The pipeline persists these at metadata top level (writeProgress's
    // extraMeta), NOT under metadata.generation — same place the
    // quality-review route reads them from.
    qualityGate: requiresReview ? meta.qualityGate ?? null : undefined,
    factCheck: requiresReview ? meta.factCheck ?? null : undefined,
    thumbnail: video.thumbnail ?? null,
    error: video.status === 'FAILED' ? generation?.error ?? 'Generation failed' : null,
  });
}
