import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/user/export — the data-portability export behind the settings
 * page's "Export My Data" button. Returns everything ForgeVid holds ABOUT
 * this account as one JSON download: profile, videos (metadata, not the
 * media bytes — those are downloadable individually from the library),
 * media-asset records, usage history, payments, subscriptions, consents,
 * localization memory, and cloned-voice records. Never includes other
 * users' data, provider API keys, or password hashes.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  const [user, videos, mediaAssets, usageRecords, payments, subscriptions, consents, translationMemory, localizationProfile, clonedVoices, leads] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, metadata: true },
      }),
      prisma.video.findMany({
        where: { userId },
        select: {
          id: true, title: true, description: true, status: true, duration: true,
          resolution: true, url: true, fileUrl: true, thumbnail: true, metadata: true,
          createdAt: true, updatedAt: true,
        },
      }),
      prisma.mediaAsset.findMany({
        where: { uploadedById: userId },
        select: { id: true, name: true, type: true, url: true, thumbnail: true, createdAt: true },
      }),
      prisma.usageRecord.findMany({
        where: { userId },
        select: { action: true, quantity: true, cost: true, metadata: true, timestamp: true },
      }),
      prisma.payment.findMany({
        where: { userId },
        select: { id: true, amount: true, currency: true, status: true, description: true, createdAt: true },
      }),
      prisma.subscription.findMany({
        where: { userId },
        select: { id: true, status: true, plan: true, currentPeriodStart: true, currentPeriodEnd: true, canceledAt: true },
      }),
      prisma.learningConsent.findMany({
        where: { userId },
        select: { purpose: true, granted: true, policyVersion: true, source: true, createdAt: true, revokedAt: true },
      }),
      prisma.translationMemory.findMany({
        where: { userId },
        select: { sourceLanguage: true, targetLanguage: true, sourceText: true, approvedText: true, approvedAt: true },
      }),
      prisma.localizationProfile.findUnique({ where: { userId } }),
      prisma.clonedVoice.findMany({
        where: { userId },
        select: {
          id: true, name: true, providerVoiceId: true, consentVersion: true, consentedAt: true,
          subjectName: true, authorizationBasis: true, trainingAllowed: true, revokedAt: true, createdAt: true,
        },
      }),
      prisma.lead.findMany({
        where: { userId },
        select: { businessName: true, vertical: true, status: true, source: true, createdAt: true },
      }),
    ]);

  const bundle = {
    exportedAt: new Date().toISOString(),
    format: 'forgevid-data-export-v1',
    user,
    videos,
    mediaAssets,
    usageRecords,
    payments,
    subscriptions,
    learningConsents: consents,
    translationMemory,
    localizationProfile,
    clonedVoices,
    leads,
  };

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="forgevid-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
