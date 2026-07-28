import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rememberTranslation } from '@/lib/localization-memory';

/**
 * The account's translation memory: human-APPROVED source→target pairs
 * that future localizations reuse verbatim instead of re-asking the LLM
 * (lib/localize.ts consults this before translating). Entries only ever
 * come from an explicit approval here — automatic translations are never
 * silently promoted into memory.
 */

const approveSchema = z.object({
  sourceLanguage: z.string().min(2).max(20).default('en'),
  targetLanguage: z.string().min(2).max(20),
  sourceText: z.string().min(1).max(2000),
  approvedText: z.string().min(1).max(2000),
});

const deleteSchema = z.object({ id: z.string().min(1) });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const entries = await prisma.translationMemory.findMany({
    where: { userId: session.user.id },
    orderBy: { approvedAt: 'desc' },
    take: 500,
    select: {
      id: true, sourceLanguage: true, targetLanguage: true,
      sourceText: true, approvedText: true, approvedAt: true,
    },
  });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const parsed = approveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  await rememberTranslation({ userId: session.user.id, ...parsed.data });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const deleted = await prisma.translationMemory.deleteMany({
    where: { id: parsed.data.id, userId: session.user.id },
  });
  if (!deleted.count) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
