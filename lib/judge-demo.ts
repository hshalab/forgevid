/**
 * The judge demo account's identity and its deterministic sample dataset —
 * shared by scripts/seed-judge-demo.ts (so a freshly seeded judge lands on
 * a populated Growth Operator, never an empty state) and
 * app/api/judge/reset/route.ts (so the in-product reset restores exactly
 * the same three items). One source of truth: a drift between "what the
 * seed creates" and "what reset restores" would make the guided tour
 * behave differently on first login vs. after a reset.
 */
export const JUDGE_EMAIL = 'judge@forgevid.com';

export const JUDGE_DEMO_DATASET = 'judge-demo-v1';

/** Fixed timestamp so the aging-based opportunity score is deterministic. */
export const JUDGE_DEMO_SEEN_AT = new Date('2026-07-01T12:00:00.000Z');

export const JUDGE_DEMO_INVENTORY = [
  { vertical: 'auto', externalRef: 'JUDGE-AUTO-001', label: '2024 ForgeVid Demo SUV', priceText: '$31,900', photoCount: 6 },
  { vertical: 'realestate', externalRef: 'JUDGE-HOME-001', label: '1925 Demo Street, Miami, FL', priceText: '$625,000', photoCount: 8 },
  { vertical: 'ecom', externalRef: 'JUDGE-SKU-001', label: 'ForgeVid Demo Travel Bag', priceText: '$89', photoCount: 5 },
] as const;
