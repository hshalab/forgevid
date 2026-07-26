import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { appendEvidence } from '@/lib/evidence-ledger';
import { recordApprovalEvent } from '@/lib/approval-events';

export const runtime = 'nodejs';
const ACTIONS = new Set(['approve', 'reject', 'request_revision', 'resubmit']);

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { id } = await props.params;
  const creative = await prisma.adCreative.findUnique({ where: { id } });
  if (!creative) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (creative.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Invalid approval action' }, { status: 400 });
  }

  if (action === 'approve') {
    if (body.rightsConfirmed !== true && creative.rightsStatus !== 'CONFIRMED') {
      return NextResponse.json(
        { error: 'Confirm that you own or are authorized to use all campaign content before approval.' },
        { status: 400 },
      );
    }
    if (!creative.videoId) {
      return NextResponse.json({ error: 'This creative has no generated video to approve.' }, { status: 400 });
    }
    const video = await prisma.video.findFirst({
      where: { id: creative.videoId, userId: session.user.id },
      select: { status: true },
    });
    if (!video || video.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'The video must finish rendering before it can be approved.' }, { status: 409 });
    }
    const updated = await prisma.adCreative.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        rightsStatus: 'CONFIRMED',
        approvedRevision: creative.revision,
        approvedAt: new Date(),
        approvedByUserId: session.user.id,
        reviewNote: note || null,
      },
    });
    await recordApprovalEvent({ creative: updated, action, actorUserId: session.user.id, rightsConfirmed: true, note });
    await appendEvidence({
      kind: 'campaign.approved',
      entityType: 'AdCreative',
      entityId: updated.id,
      actorUserId: session.user.id,
      payload: { action, revision: updated.revision, approvedRevision: updated.approvedRevision, rightsStatus: updated.rightsStatus, note },
    });
    return NextResponse.json({ creative: updated, publicUrl: `/l/${updated.id}` });
  }

  if ((action === 'reject' || action === 'request_revision') && !note) {
    return NextResponse.json({ error: 'A review note is required for this action.' }, { status: 400 });
  }

  const data =
    action === 'resubmit'
      ? {
          approvalStatus: 'AWAITING_REVIEW',
          revision: { increment: 1 },
          approvedRevision: null,
          approvedAt: null,
          approvedByUserId: null,
          reviewNote: note || null,
          rightsStatus: 'UNCONFIRMED',
        }
      : {
          approvalStatus: action === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED',
          approvedRevision: null,
          approvedAt: null,
          approvedByUserId: null,
          reviewNote: note,
        };
  const updated = await prisma.adCreative.update({ where: { id }, data });
  await recordApprovalEvent({
    creative: updated,
    action,
    actorUserId: session.user.id,
    rightsConfirmed: false,
    note,
  });
  await appendEvidence({
    kind: `campaign.${action}`,
    entityType: 'AdCreative',
    entityId: updated.id,
    actorUserId: session.user.id,
    payload: { action, revision: updated.revision, approvalStatus: updated.approvalStatus, note },
  });
  return NextResponse.json({ creative: updated, publicUrl: null });
}
