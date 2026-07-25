import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { checkSimpleRateLimit, clientIp } from '@/lib/simple-rate-limit';
import { LeadCaptureForm } from './lead-capture-form';

export const dynamic = 'force-dynamic';

/**
 * Public campaign landing page. No auth — anyone with the link (or a QR
 * code pointing at it) can view it. `id` is the AdCreative's own cuid,
 * already unguessable, used directly as the public link segment.
 */
export default async function CreativeLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const creative = await prisma.adCreative.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      videoId: true,
      approvalStatus: true,
      revision: true,
      approvedRevision: true,
    },
  });

  if (!creative || creative.approvalStatus !== 'APPROVED' || creative.approvedRevision !== creative.revision) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">This link is no longer active</h1>
        <p className="text-sm text-muted-foreground">The campaign it pointed to has been removed.</p>
      </div>
    );
  }

  const video = creative.videoId
    ? await prisma.video.findUnique({
        where: { id: creative.videoId },
        select: { status: true, fileUrl: true, url: true, thumbnail: true },
      })
    : null;

  // Best-effort view logging, rate-limited per IP so a crawler can't flood
  // the table; never blocks the page from rendering.
  try {
    const headerList = await headers();
    const ip = clientIp({ headers: { get: (name: string) => headerList.get(name) } });
    if (checkSimpleRateLimit(`lead-view:${ip}:${id}`, 20, 60_000)) {
      await prisma.creativeEvent.create({ data: { creativeId: id, kind: 'view' } });
    }
  } catch (err) {
    console.error('[landing] view logging failed:', err);
  }

  const videoUrl = video?.status === 'COMPLETED' ? video.fileUrl || video.url : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <div className="overflow-hidden rounded-lg bg-muted">
        {videoUrl ? (
          <video src={videoUrl} poster={video?.thumbnail || undefined} controls playsInline className="w-full" />
        ) : (
          <div className="flex aspect-[9/16] items-center justify-center text-sm text-muted-foreground">
            Video preview unavailable
          </div>
        )}
      </div>
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">{creative.label}</h1>
        <p className="text-sm text-muted-foreground">Interested? Leave your info and they'll reach out.</p>
      </div>
      <LeadCaptureForm creativeId={creative.id} />
    </div>
  );
}
