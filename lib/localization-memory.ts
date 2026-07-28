import crypto from 'crypto';
import { prisma } from './prisma';
import type { PronunciationEntry } from './pronunciation';

export function translationHash(sourceText: string): string {
  return crypto.createHash('sha256').update(sourceText.trim()).digest('hex');
}

export async function getLocalizationProfile(userId: string) {
  return prisma.localizationProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function approvedTranslation(
  userId: string,
  sourceLanguage: string,
  targetLanguage: string,
  sourceText: string,
): Promise<string | null> {
  const row = await prisma.translationMemory.findUnique({
    where: {
      userId_sourceLanguage_targetLanguage_sourceTextHash: {
        userId,
        sourceLanguage,
        targetLanguage,
        sourceTextHash: translationHash(sourceText),
      },
    },
    select: { approvedText: true },
  });
  return row?.approvedText ?? null;
}

export async function rememberTranslation(input: {
  userId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
  approvedText: string;
}): Promise<void> {
  const sourceText = input.sourceText.trim();
  const approvedText = input.approvedText.trim();
  await prisma.translationMemory.upsert({
    where: {
      userId_sourceLanguage_targetLanguage_sourceTextHash: {
        userId: input.userId,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        sourceTextHash: translationHash(sourceText),
      },
    },
    create: {
      ...input,
      sourceText,
      approvedText,
      sourceTextHash: translationHash(sourceText),
      approvedByUserId: input.userId,
    },
    update: { approvedText, approvedByUserId: input.userId, approvedAt: new Date() },
  });
}

export function profilePronunciations(profile: { pronunciations: unknown }): PronunciationEntry[] {
  if (!Array.isArray(profile.pronunciations)) return [];
  return profile.pronunciations
    .filter((entry): entry is { spelled: string; saysAs: string } =>
      Boolean(entry && typeof entry === 'object' && typeof (entry as any).spelled === 'string' && typeof (entry as any).saysAs === 'string'),
    )
    .slice(0, 200);
}
