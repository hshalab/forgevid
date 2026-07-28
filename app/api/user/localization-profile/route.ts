import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getLocalizationProfile } from '@/lib/localization-memory';

/**
 * The corporate localization profile — the per-account layer that steers
 * every translation this account runs: tone/formality directives, a
 * glossary of terms that must render exactly as specified (brand names,
 * product lines), and pronunciation entries for TTS. Consumed by
 * lib/localize.ts's translateNarrationLines whenever a localization runs
 * for this user.
 */

const profileSchema = z.object({
  defaultLocale: z.string().min(2).max(20).optional(),
  regionalPreference: z.string().max(60).nullable().optional(),
  tone: z.enum(['professional', 'friendly', 'energetic', 'luxury']).optional(),
  formality: z.enum(['formal', 'neutral', 'casual']).optional(),
  glossary: z.record(z.string().min(1).max(120), z.string().min(1).max(120)).optional(),
  pronunciations: z
    .array(z.object({ spelled: z.string().min(1).max(80), saysAs: z.string().min(1).max(120) }))
    .max(200)
    .optional(),
  requireHumanReview: z.boolean().optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const profile = await getLocalizationProfile(session.user.id);
  return NextResponse.json({ profile });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.glossary && Object.keys(parsed.data.glossary).length > 200) {
    return NextResponse.json({ error: 'Glossary is limited to 200 terms' }, { status: 400 });
  }
  const profile = await prisma.localizationProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json({ profile });
}
