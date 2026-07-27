import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkSimpleRateLimit, clientIp } from '@/lib/simple-rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/l/[id] — public lead capture from a campaign landing page
 * (app/l/[id]/page.tsx). No auth: the visitor is a stranger, not a ForgeVid
 * account. `id` is the AdCreative's own cuid — already unguessable, so it
 * doubles as the public link segment with no separate slug/token needed.
 *
 * This is NOT the `Lead` model (that's ForgeVid's own outbound sales
 * pipeline) — it's a CreativeEvent, since a visitor interested in a
 * customer's listing/product is that customer's lead, not ForgeVid's.
 */

const bodySchema = z.object({
  name: z.string().max(200).optional().or(z.literal('')),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(60).optional().or(z.literal('')),
  message: z.string().max(1000).optional().or(z.literal('')),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const ip = clientIp(req);
  if (!checkSimpleRateLimit(`lead-submit:${ip}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many submissions — try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { name, email, phone, message } = parsed.data;
  if (!email && !phone) {
    return NextResponse.json({ error: 'An email or phone number is required so the business can reach you.' }, { status: 400 });
  }

  // Same gate the landing page enforces (app/l/[id]/page.tsx): only the
  // approved current revision accepts leads. Without this, a rejected or
  // since-revised creative's page would 404 while a direct POST here still
  // recorded events against it — an approval bypass for anyone who kept
  // the URL.
  const creative = await prisma.adCreative.findUnique({
    where: { id: params.id },
    select: { id: true, approvalStatus: true, approvedRevision: true, revision: true },
  });
  if (!creative || creative.approvalStatus !== 'APPROVED' || creative.approvedRevision !== creative.revision) {
    return NextResponse.json({ error: 'This link is no longer active.' }, { status: 404 });
  }

  await prisma.creativeEvent.create({
    data: {
      creativeId: creative.id,
      kind: 'lead_submitted',
      name: name || null,
      email: email || null,
      phone: phone || null,
      message: message || null,
    },
  });

  return NextResponse.json({ success: true });
}
