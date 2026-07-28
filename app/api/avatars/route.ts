import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { allowsAvatars, getUserPlan } from '@/lib/plan';
import { isAvatarProviderConfigured, listAvatars } from '@/lib/avatar-provider';

/**
 * GET /api/avatars — the avatars available for avatar-video generation.
 * Pro plans only; 503 when no provider key is configured.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const plan = await getUserPlan(session.user.id);
  if (!allowsAvatars(plan)) {
    return NextResponse.json(
      { error: `Avatar videos require the Pro plan (you are on ${plan})`, upgradeRequired: true },
      { status: 403 },
    );
  }

  if (!isAvatarProviderConfigured()) {
    return NextResponse.json(
      { error: 'Avatar generation is unavailable (HEYGEN_API_KEY is not configured)' },
      { status: 503 },
    );
  }

  try {
    const avatars = await listAvatars();
    // Presenter memory (the avatar arm of the learning system): the user's
    // most-used presenter across their own completed avatar renders, so the
    // picker opens on the presenter they actually work with. Rules-first —
    // a plain frequency count over their own videos, never cross-user.
    let recommendedAvatarId: string | null = null;
    try {
      const rows = await prisma.video.findMany({
        where: { userId: session.user.id, status: 'COMPLETED', metadata: { contains: '"source":"avatar"' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { metadata: true },
      });
      const counts = new Map<string, number>();
      for (const row of rows) {
        try {
          const avatarId = JSON.parse(row.metadata ?? '{}')?.provider?.avatarId;
          if (typeof avatarId === 'string' && avatarId) counts.set(avatarId, (counts.get(avatarId) ?? 0) + 1);
        } catch {
          /* malformed metadata — skip */
        }
      }
      let best = 0;
      counts.forEach((count, avatarId) => {
        if (count > best) {
          best = count;
          recommendedAvatarId = avatarId;
        }
      });
    } catch {
      /* recommendation is best-effort — the list must still load */
    }
    return NextResponse.json({ avatars, recommendedAvatarId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not list avatars';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
