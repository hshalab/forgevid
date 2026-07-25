import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { safeFetch } from '@/lib/safe-fetch';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  urls: z.array(z.string().url().max(2048)).min(1).max(12),
  sourceUrl: z.string().url().max(2048).optional(),
});

function sameUrl(a: string, b?: string): boolean {
  if (!b) return false;
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = '';
    right.hash = '';
    return left.toString() === right.toString();
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter valid direct image URLs, one per line.' }, { status: 400 });
  }

  const results = [];
  for (const url of parsed.data.urls) {
    if (sameUrl(url, parsed.data.sourceUrl)) {
      results.push({ url, valid: false, reason: 'This is the original listing/detail page, not a direct photo URL.' });
      continue;
    }
    try {
      const response = await safeFetch(url, {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 10_000,
        acceptTypes: ['image'],
        headers: { Accept: 'image/*' },
      });
      results.push({ url, valid: response.body.length > 0, reason: response.body.length > 0 ? undefined : 'The image was empty.' });
    } catch (error) {
      results.push({
        url,
        valid: false,
        reason: error instanceof Error && /content type/i.test(error.message)
          ? 'This URL opens a web page, not an image.'
          : 'ForgeVid could not fetch this image. Upload the photo instead.',
      });
    }
  }

  const invalid = results.filter((result) => !result.valid);
  return NextResponse.json({ valid: invalid.length === 0, results, invalid });
}
