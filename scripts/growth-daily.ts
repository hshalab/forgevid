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
  splitByMetro,
  type BatchPick,
  type Vertical,
} from '../lib/growth-ops';
import { newestArrivalUrl } from '../lib/newest-inventory';

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
    // 20/day: 10 Bay Area (the operator's home turf — walk-in ready) + 10
    // from the rest of the trackers (Miami-first remote outbound).
    count: Number(get('--count')) || 20,
  };
}

function scaledMix(count: number): Record<Vertical, number> {
  const scale = count / 10;
  return {
    auto: Math.max(1, Math.round(6 * scale)),
    realestate: Math.max(1, Math.round(2 * scale)),
    ecom: Math.max(1, Math.round(2 * scale)),
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

function renderSample(pick: BatchPick, sourceUrl: string): { ok: boolean; detail: string } {
  // TTS is the scarce resource (ElevenLabs character quota): a
  // Spanish-FIRST account gets the Spanish clip only — it's the better
  // pitch for them anyway — and 'both' is reserved for genuinely bilingual
  // accounts. This halves the character burn on ES rows.
  const language = pick.row.language.toLowerCase();
  const lang = language === 'en' ? 'en' : language === 'es' ? 'es' : 'both';
  const args = [
    'tsx',
    'scripts/prospect-sample.ts',
    sourceUrl,
    '--vertical', pick.vertical,
    '--dealer', pick.row.name,
    '--lang', lang,
    '--email', process.env.MARKETING_EMAIL ?? '',
  ];
  // shell:true (needed for npx on Windows) joins args WITHOUT quoting —
  // an unquoted multi-word dealer name gets split into separate tokens,
  // and the tracker then matches on a partial name. Quote anything with
  // whitespace.
  const quoted = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  const result = spawnSync('npx', quoted, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
  });
  const ok = result.status === 0;
  const stdoutTail = (result.stdout ?? '').trim().split('\n').slice(-3).join(' | ');
  return {
    ok,
    detail: ok
      ? stdoutTail
      : `exit ${result.status}: ${((result.stderr ?? '') + ' ' + stdoutTail).trim().slice(-300)}`,
  };
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

  // Half the quota from the Bay Area (home turf), half from everywhere
  // else (Miami-first). If the Bay Area pool runs short, the remainder
  // backfills from the rest — the daily total is the commitment.
  const half = Math.ceil(opts.count / 2);
  const { bay, rest } = splitByMetro(trackers);
  const bayBatch = pickDailyBatch(bay, scaledMix(half));
  const restBatch = pickDailyBatch(rest, scaledMix(opts.count - bayBatch.length));
  const batch = [...bayBatch, ...restBatch];
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

  const results: Array<{ pick: BatchPick; ok: boolean; detail: string; freshArrival: boolean }> = [];
  for (const pick of batch) {
    // Automotive: feature the freshest car on their lot, not the homepage —
    // dealer inventory pages list newest-first (lib/newest-inventory.ts).
    // Best-effort: any miss falls back to the tracker's site URL.
    let sourceUrl = pick.row.website;
    let freshArrival = false;
    if (pick.vertical === 'auto') {
      const newest = await newestArrivalUrl(pick.row.website);
      sourceUrl = newest.url;
      freshArrival = newest.isVehiclePage;
      if (freshArrival) console.log(`  newest arrival: ${sourceUrl}`);
    }
    console.log(`[growth-daily] rendering ${pick.row.name}…`);
    const result = renderSample(pick, sourceUrl);
    results.push({ pick, ...result, freshArrival });
    console.log(`  ${result.ok ? 'OK' : 'FAILED'} — ${result.detail}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push(`TODAY'S SAMPLES (${okCount}/${results.length} rendered — each arrived as its own [PROSPECT] email with the clip + DM text):`);
  lines.push('');
  for (const { pick, ok, detail, freshArrival } of results) {
    lines.push(`${ok ? '✅' : '❌'} [${pick.vertical}] ${pick.row.name} (${pick.row.language || 'EN'}) · ${pick.row.metro}`);
    lines.push(`   send via: ${contactLine(pick.row)}`);
    if (freshArrival) lines.push('   featuring their NEWEST arrival — mention "just saw the latest car you got in" in the DM');
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
