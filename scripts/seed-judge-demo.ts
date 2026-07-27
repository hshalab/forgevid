/**
 * Seeds (or re-seeds) a single demo account for XPRIZE judges — a real,
 * ordinary USER account with an active Pro subscription so nothing in the
 * product paywalls them. Deliberately does NOT grant admin access: the
 * evidence dashboard shows every real customer's data (leads, Gemini
 * prompts, contact info), and handing that to an external party would leak
 * PII that isn't the judge's to see. Financial/evidence numbers go to
 * judges as a static export instead (see evidence/JUDGE-TESTING-INSTRUCTIONS.md).
 *
 * Deliberately NOT wired into prisma/seed-production.cjs or the Docker CMD —
 * this runs once, by hand, when you actually want a judge account to exist.
 * This repo is PUBLIC — the password is never hardcoded here or logged; it
 * only ever lives in the env var you set for the run and in whatever
 * private channel (e.g. the Devpost submission's non-public testing-
 * instructions field) you hand it to judges through.
 *
 *   JUDGE_DEMO_PASSWORD='pick-one' npx tsx scripts/seed-judge-demo.ts               # local dev db
 *   DATABASE_URL=<railway-url> JUDGE_DEMO_PASSWORD='pick-one' npx tsx scripts/seed-judge-demo.ts  # production
 *
 * Idempotent (upsert by email) — safe to re-run. Re-running with a new
 * JUDGE_DEMO_PASSWORD rotates the password on the existing account.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { JUDGE_DEMO_INVENTORY, JUDGE_DEMO_SEEN_AT, JUDGE_EMAIL } from '../lib/judge-demo';

async function main() {
  const password = process.env.JUDGE_DEMO_PASSWORD;
  if (!password || password.length < 12) {
    console.error('Set JUDGE_DEMO_PASSWORD (12+ chars) — never hardcode it, this repo is public.');
    process.exit(1);
  }

  const bcrypt = (await import('bcryptjs')).default;
  const { prisma } = await import('../lib/prisma');

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: JUDGE_EMAIL },
    update: { password: hashed, status: 'ACTIVE', role: 'USER' },
    create: {
      email: JUDGE_EMAIL,
      name: 'XPRIZE Judge',
      password: hashed,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
  });
  console.log(`User: ${user.email} (${user.id})`);

  const existingSub = await prisma.subscription.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
  });
  if (existingSub) {
    console.log(`Subscription: already active (${existingSub.id}), left as-is`);
  } else {
    const now = new Date();
    const oneYearOut = new Date(now);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        status: 'ACTIVE',
        plan: 'pro',
        currentPeriodStart: now,
        currentPeriodEnd: oneYearOut,
        metadata: JSON.stringify({ note: 'XPRIZE judge demo account — no real payment, not counted as revenue' }),
      },
    });
    console.log(`Subscription: created (${sub.id}), pro plan, active for 1 year`);
  }

  // Preload the deterministic demo inventory ONLY when the judge has none —
  // a first login must never land on empty states (the guided tour's first
  // step is the scored inventory), but re-running the seed to rotate the
  // password must not wipe whatever the judge generated mid-session. The
  // in-product reset button (POST /api/judge/reset) is the wipe mechanism,
  // and restores exactly this same lib/judge-demo dataset.
  const inventoryCount = await prisma.inventoryItem.count({ where: { userId: user.id } });
  if (inventoryCount === 0) {
    for (const sample of JUDGE_DEMO_INVENTORY) {
      await prisma.inventoryItem.create({
        data: { userId: user.id, ...sample, firstSeenAt: JUDGE_DEMO_SEEN_AT, lastSeenAt: JUDGE_DEMO_SEEN_AT },
      });
    }
    console.log(`Inventory: preloaded ${JUDGE_DEMO_INVENTORY.length} demo items (judge-demo-v1)`);
  } else {
    console.log(`Inventory: ${inventoryCount} items already present, left as-is`);
  }

  console.log('\nDone. Login instructions are in evidence/JUDGE-TESTING-INSTRUCTIONS.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
