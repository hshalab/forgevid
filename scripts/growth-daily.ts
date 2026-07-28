/**
 * Daily growth ops — renders the day's personalized prospect samples and
 * emails the operator ONE digest, so the morning routine is: open inbox,
 * review, send. Scheduled via scripts/growth-cron.cmd (Task Scheduler).
 *
 *   npx tsx scripts/growth-daily.ts              # full run (renders + emails)
 *   npx tsx scripts/growth-daily.ts --dry-run    # show today's batch, render nothing
 *   npx tsx scripts/growth-daily.ts --count 4    # smaller batch (scales the 6/2/2 mix)
 *
 * What lands in the inbox:
 *   - one [PROSPECT] email PER SAMPLE (from prospect-sample.ts: the clip +
 *     copy-paste DM text in the right language) — these already existed;
 *   - one 📬 digest email: the batch list with per-account contact
 *     channels, plus every follow-up due today (D+2/D+5/D+10) with a
 *     ready-to-send message.
 *
 * COMPLIANCE: every email goes to MARKETING_EMAIL (the operator). Nothing
 * here contacts a prospect — the human sends, same as always.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  followUpsDue,
  parseTracker,
  pickDailyBatch,
  type BatchPick,
  type Vertical,
} from '../lib/growth-ops';

const TRACKER_FILES: Record<Vertical, string> = {
  auto: 'dealers.csv',
  realestate: 'realtors.csv',
  ecom: 'ecommerce.csv',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    dryRun: args.includes('--dry-run'),
    count: Number(get('--count')) || 10,
  };
}

function loadTrackers() {
  const trackers = {} as Record<Vertical, ReturnType<typeof parseTracker>>;
  for (const [vertical, file] of Object.entries(TRACKER_FILES) as [Vertical, string][]) {
    const full = path.join(process.cwd(), 'outbound', file);
    trackers[vertical] = fs.existsSync(full) ? parseTracker(fs.readFileSync(full, 'utf8')) : [];
  }
  return trackers;
}

function contactLine(row: { instagram: string; whatsapp: string; email: string; phone: string }): string {
  const channels = [
    row.instagram && `IG ${row.instagram}`,
    row.whatsapp && `WhatsApp ${row.whatsapp}`,
    row.email && `email ${row.email}`,
    row.phone && `tel ${row.phone}`,
  ].filter(Boolean);
  return channels.length ? channels.join(' · ') : 'NO CONTACT CHANNEL ON FILE — enrich first';
}

function renderSample(pick: BatchPick): { ok: boolean; detail: string } {
  const lang = pick.row.language.toLowerCase() === 'en' ? 'en' : 'both';
  const args = [
    'tsx',
    'scripts/prospect-sample.ts',
    pick.row.website,
    '--vertical', pick.vertical,
    '--dealer', pick.row.name,
    '--lang', lang,
    '--email', process.env.MARKETING_EMAIL ?? '',
  ];
  const result = spawnSync('npx', args, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
  });
  const ok = result.status === 0;
  const tail = (result.stdout ?? '').trim().split('\n').slice(-3).join(' | ');
  return { ok, detail: ok ? tail : `exit ${result.status}: ${(result.stderr ?? '').slice(-300)}` };
}

async function sendDigest(subject: string, body: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS.includes('PASTE')) {
    console.log('[growth-daily] SMTP not configured — digest printed above only');
    return;
  }
  const to = process.env.MARKETING_EMAIL;
  if (!to) {
    console.log('[growth-daily] MARKETING_EMAIL not set — digest printed above only');
    return;
  }
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'ForgeVid <noreply@forgevid.com>',
    to,
    subject,
    text: body,
  });
  console.log(`[growth-daily] digest emailed to ${to}`);
}

async function main() {
  const opts = parseArgs();
  const trackers = loadTrackers();

  // Scale the default 6/2/2 mix to the requested count.
  const scale = opts.count / 10;
  const mix = {
    auto: Math.max(1, Math.round(6 * scale)),
    realestate: Math.max(1, Math.round(2 * scale)),
    ecom: Math.max(1, Math.round(2 * scale)),
  };
  const batch = pickDailyBatch(trackers, mix);
  const due = followUpsDue(trackers, new Date());

  console.log(`[growth-daily] batch: ${batch.length} samples · follow-ups due: ${due.length}`);
  for (const pick of batch) {
    console.log(`  [${pick.vertical}] ${pick.row.name} — ${pick.row.website} (${pick.row.language || 'EN'})`);
  }

  if (opts.dryRun) {
    for (const f of due) {
      console.log(`  FOLLOW-UP ${f.stage} (${f.daysSince}d) [${f.vertical}] ${f.row.name}`);
    }
    return;
  }

  const results: Array<{ pick: BatchPick; ok: boolean; detail: string }> = [];
  for (const pick of batch) {
    console.log(`[growth-daily] rendering ${pick.row.name}…`);
    const result = renderSample(pick);
    results.push({ pick, ...result });
    console.log(`  ${result.ok ? 'OK' : 'FAILED'} — ${result.detail}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push(`TODAY'S SAMPLES (${okCount}/${results.length} rendered — each arrived as its own [PROSPECT] email with the clip + DM text):`);
  lines.push('');
  for (const { pick, ok, detail } of results) {
    lines.push(`${ok ? '✅' : '❌'} [${pick.vertical}] ${pick.row.name} (${pick.row.language || 'EN'})`);
    lines.push(`   send via: ${contactLine(pick.row)}`);
    if (!ok) lines.push(`   render failed: ${detail} — run it by hand or pick the next tracker row`);
    lines.push('');
  }
  lines.push(`FOLLOW-UPS DUE TODAY (${due.length}):`);
  lines.push('');
  if (!due.length) lines.push('none — the pipeline is fully current.');
  for (const f of due) {
    lines.push(`${f.stage} · ${f.daysSince} days · [${f.vertical}] ${f.row.name}`);
    lines.push(`   send via: ${contactLine(f.row)}`);
    lines.push(`   suggested: ${f.message}`);
    lines.push('');
  }
  lines.push('After sending: update outbound/*.csv statuses (NEW→SAMPLE_SENT, response column on replies).');

  const body = lines.join('\n');
  console.log('\n' + body);
  await sendDigest(
    `📬 Growth ops ${new Date().toISOString().slice(0, 10)}: ${okCount} samples ready · ${due.length} follow-ups due`,
    body,
  );
}

main().catch((error) => {
  console.error('[growth-daily] fatal:', error);
  process.exit(1);
});
