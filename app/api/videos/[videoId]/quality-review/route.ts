import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordCustomerEvaluation } from '@/lib/learning-system';

async function ownedVideo(videoId: string, userId: string) {
  return prisma.video.findFirst({
    where: { id: videoId, userId },
    select: { id: true, status: true, metadata: true, url: true, fileUrl: true, thumbnail: true },
  });
}

export async function GET(_request: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { videoId } = await props.params;
  const video = await ownedVideo(videoId, session.user.id);
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let metadata: any = {};
  try { metadata = video.metadata ? JSON.parse(video.metadata) : {}; } catch {}
  return NextResponse.json({
    videoId,
    status: video.status,
    previewUrl: video.fileUrl || video.url,
    thumbnail: video.thumbnail,
    qualityGate: metadata.qualityGate ?? null,
    factCheck: metadata.factCheck ?? null,
  });
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { videoId } = await props.params;
  const video = await ownedVideo(videoId, session.user.id);
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body.action !== 'accept' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be accept or reject' }, { status: 400 });
  }
  // Both verbs only make sense against a held video — "rejecting" a
  // COMPLETED one would silently record a customer evaluation for a video
  // that was never under review.
  if (video.status !== 'REVIEW_REQUIRED') {
    return NextResponse.json({ error: 'This video is not awaiting review' }, { status: 409 });
  }
  if (body.action === 'accept') {
    await prisma.video.update({ where: { id: videoId }, data: { status: 'COMPLETED' } });
  }
  await recordCustomerEvaluation({
    userId: session.user.id,
    videoId,
    accepted: body.action === 'accept',
    rating: Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null,
    editSummary: typeof body.notes === 'string' ? body.notes : null,
  });
  return NextResponse.json({ ok: true, status: body.action === 'accept' ? 'COMPLETED' : video.status });
}
