/**
 * In-process, fixed-window rate limiting for low-traffic public endpoints.
 * Per-instance only (not distributed across Railway replicas) — an
 * intentional, honest tradeoff: this is a new feature with no real traffic
 * yet, so a Redis-backed limiter would be unverified complexity for a
 * problem that doesn't exist yet. Revisit if traffic actually justifies it.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkSimpleRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
