/**
 * Prospect sample generator — the fuel for the 5-samples/day outbound quota.
 *
 * One command turns a dealership's OWN website into a personalized bilingual
 * sample clip and emails it to you ready to DM:
 *
 *   npx tsx scripts/prospect-sample.ts https://machadoauto.com
 *   npx tsx scripts/prospect-sample.ts https://machadoauto.com --dealer "Machado Auto Sales"
 *   npx tsx scripts/prospect-sample.ts <url> --lang en --aspect 16:9 --duration 30
 *
 * What it does:
 *   1. Reads the dealer's site (same SSRF-guarded extractor the product uses)
 *   2. LLM writes a commercial script grounded in THEIR actual content
 *   3. Uses THEIR OWN site images as the footage (Ken Burns) — falls back to
 *      stock car-lot footage if the site exposes no usable images (the email
 *      tells you which happened)
 *   4. Renders EN + ES versions with karaoke captions (9:16 by default)
 *   5. Emails each clip to MARKETING_EMAIL with a ready-to-send DM message
 *   6. --dealer "Name" marks the row in outbound/dealers.csv as SAMPLE_SENT
 *
 * Cost: ~$0.50 per prospect (script LLM + 2x TTS + Whisper). Output also lands
 * in outbound/samples/.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

type Lang = 'en' | 'es';

function parseArgs() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const langArg = (get('--lang') || 'both') as Lang | 'both';
  const vertical = (get('--vertical') || 'auto') as Vertical;
  return {
    url,
    vertical,
    // Which tracker --dealer updates; defaults per vertical.
    csv:
      get('--csv') ||
      ({ auto: 'dealers.csv', realestate: 'realtors.csv', ecom: 'ecommerce.csv' } as const)[vertical],
    dealer: get('--dealer'),
    langs: (langArg === 'both' ? ['en', 'es'] : [langArg]) as Lang[],
    aspect: (get('--aspect') || '9:16') as '9:16' | '16:9' | '1:1',
    duration: Number(get('--duration')) || 24,
    email: get('--email') || process.env.MARKETING_EMAIL || undefined,
  };
}

/** Split one narration into n roughly word-balanced sentence chunks. */
function splitNarration(text: string, n: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  if (sentences.length <= n) return sentences;
  const perChunk = Math.ceil(sentences.reduce((w, s) => w + s.split(/\s+/).length, 0) / n);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && (current + ' ' + s).split(/\s+/).length > perChunk && chunks.length < n - 1) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

type Vertical = 'auto' | 'realestate' | 'ecom';

const DM_TEMPLATES: Record<Vertical, Record<Lang, (brand: string) => string>> = {
  auto: {
    en: (brand) =>
      `Hi — I took ${brand}'s website and turned it into this video. Took 4 minutes, no camera, available in English and Spanish. I can do this for your whole inventory automatically every morning. Want me to run 5 of your vehicles as a free demo?`,
    es: (brand) =>
      `Hola — tomé el sitio de ${brand} y lo convertí en este video. Tomó 4 minutos, sin cámara, disponible en inglés y español. Puedo hacerlo con todo su inventario automáticamente cada mañana. ¿Le corro 5 vehículos como demo gratis?`,
  },
  realestate: {
    en: (brand) =>
      `Hi — I turned ${brand}'s website into this video. Took 4 minutes, no filming, English and Spanish. I can do this for every one of your listings automatically — address, price, beds and baths burned in. Want me to run 3 of your active listings as a free demo?`,
    es: (brand) =>
      `Hola — convertí el sitio de ${brand} en este video. Tomó 4 minutos, sin filmar, en inglés y español. Puedo hacerlo con cada una de sus propiedades automáticamente — dirección, precio y detalles incluidos. ¿Le corro 3 propiedades activas como demo gratis?`,
  },
  ecom: {
    en: (brand) =>
      `Hi — I turned ${brand}'s store into this video. Took 4 minutes, no shoot, ready for Reels/TikTok. I can do this for every product in your catalog automatically. Want me to run 5 of your products as a free demo?`,
    es: (brand) =>
      `Hola — convertí la tienda de ${brand} en este video. Tomó 4 minutos, sin sesión de fotos, listo para Reels/TikTok. Puedo hacerlo con cada producto de su catálogo automáticamente. ¿Le corro 5 productos como demo gratis?`,
  },
};

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const opts = parseArgs();
  if (!opts.url) {
    console.error('Usage: npx tsx scripts/prospect-sample.ts <prospect-url> [--vertical auto|realestate|ecom] [--dealer "Name"] [--csv dealers.csv] [--lang en|es|both] [--aspect 9:16] [--duration 24]');
    process.exit(1);
  }

  const { extractSite } = await import('../lib/site-extract');
  const { writeCommercialScript } = await import('../lib/commercial-script');
  const { createLlmClient, llmModel } = await import('../lib/ai/llm');
  const { safeFetch, withDefaultScheme } = await import('../lib/safe-fetch');
  const { resolveSceneClips, assembleVideo } = await import('../lib/video-generator');
  const { synthesizeSceneVoiceovers } = await import('../lib/voiceover');
  const { CAPTION_PRESETS } = await import('../lib/captions');

  const url = withDefaultScheme(opts.url);
  const host = new URL(url).hostname.replace(/^www\./, '');
  const outDir = path.join(process.cwd(), 'outbound', 'samples');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[1/5] Reading ${url} ...`);
  const content = await extractSite(url);
  if (content.sparse && !content.text) {
    console.error('The site gave us almost nothing to work with (client-rendered shell). Try their inventory page URL, or skip to the generic dealer clip.');
    process.exit(2);
  }
  console.log(`      title: "${content.title}" | ${content.images.length} image(s) found | read: ${content.renderedWith}`);

  console.log('[2/5] Writing the commercial script from their real content ...');
  const script = await writeCommercialScript(content, { duration: opts.duration, tone: 'energetic' });
  const brand = script.brand || content.title || host;
  const narrationEn = `${script.narration} ${script.callToAction ?? ''}`.trim();

  const narrations: Record<Lang, string> = { en: narrationEn, es: '' };
  if (opts.langs.includes('es')) {
    console.log('[2b]  Translating to Spanish ...');
    const llm = createLlmClient();
    const res = await llm.chat.completions.create({
      model: llmModel('fast'),
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content:
            'Translate the given video narration into natural, fluent Latin-American Spanish. Keep brand names and URLs exactly as written. Reply with ONLY the translation.',
        },
        { role: 'user', content: narrationEn },
      ],
    });
    narrations.es = (res.choices[0]?.message?.content || '').trim();
    if (!narrations.es) throw new Error('Spanish translation came back empty — retry');
  }

  console.log('[3/5] Fetching their site images ...');
  const tempDir = path.join(process.cwd(), 'public', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const localImages: string[] = [];
  const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  for (const img of content.images.slice(0, 8)) {
    if (localImages.length >= 6) break;
    try {
      const { body, contentType } = await safeFetch(img, {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 10_000,
        acceptTypes: ['image'],
        headers: { Accept: 'image/*' },
      });
      const ext = EXT[contentType.split(';')[0].trim().toLowerCase()];
      if (!ext || body.length < 5_000) continue; // skip icons/trackers
      const p = path.join(tempDir, `prospect_${host.replace(/\W/g, '')}_${localImages.length}.${ext}`);
      fs.writeFileSync(p, body);
      localImages.push(p);
    } catch {
      /* hotlink-blocked or dead — skip */
    }
  }
  const usingSiteImages = localImages.length >= 2;
  console.log(
    usingSiteImages
      ? `      using ${localImages.length} of THEIR images (the strong pitch)`
      : `      only ${localImages.length} usable image(s) — falling back to stock car footage (pitch still personalized in words)`,
  );

  const results: string[] = [];
  for (const lang of opts.langs) {
    console.log(`[4/5] Rendering ${lang.toUpperCase()} sample ...`);
    const chunks = splitNarration(narrations[lang], 4);

    let resolved: any[];
    if (usingSiteImages) {
      resolved = chunks.map((narration, i) => ({
        id: `scene-${i + 1}`,
        index: i,
        description: narration,
        narration,
        searchQuery: 'dealer site image',
        keywords: [],
        duration: 2,
        visualElements: [],
        clipUrl: localImages[i % localImages.length],
        matchedQuery: 'site image',
        mediaType: 'image' as const,
      }));
    } else {
      const FALLBACKS: Record<Vertical, string[]> = {
        auto: ['car dealership lot', 'car showroom', 'salesman handshake car', 'happy customer car'],
        realestate: ['modern house exterior', 'modern house interior', 'real estate agent keys', 'sold sign house'],
        ecom: ['online shopping phone', 'product photography studio', 'warehouse packages', 'person smiling phone'],
      };
      const FALLBACK_QUERIES = FALLBACKS[opts.vertical];
      const planned = chunks.map((narration, i) => ({
        id: `scene-${i + 1}`,
        index: i,
        description: narration,
        narration,
        searchQuery: FALLBACK_QUERIES[i % FALLBACK_QUERIES.length],
        keywords: [],
        duration: 2,
        visualElements: [],
      }));
      resolved = await resolveSceneClips(planned as any, opts.aspect);
    }

    const sceneVoiceovers = await synthesizeSceneVoiceovers(
      resolved.map((s: any) => ({ id: s.id, description: s.narration })),
      process.env.ELEVENLABS_VOICE_ID ?? null,
    );
    if (!sceneVoiceovers) throw new Error('narration synthesis failed (ELEVENLABS_API_KEY?)');

    const { videoUrl } = await assembleVideo(resolved as any, ['voiceover', 'subtitles'], opts.aspect, {
      // Big animated brand-name opener (Bebas Neue) — the produced-ad look.
      openerTitle: brand,
      sceneVoiceovers,
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
      transition: null,
      renderQuality: 'full',
      captionStyle: CAPTION_PRESETS.karaoke,
      captionAnimation: 'karaoke',
      language: lang,
    });

    const outPath = path.join(outDir, `${host.replace(/\W/g, '-')}-${lang}.mp4`);
    if (videoUrl.startsWith('/')) {
      fs.copyFileSync(path.join(process.cwd(), 'public', videoUrl.replace(/^\/+/, '')), outPath);
    } else {
      const res = await fetch(videoUrl);
      fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    }
    results.push(outPath);
    console.log(`      done: ${outPath}`);

    if (opts.email) {
      await emailSample(opts.email, host, brand, lang, outPath, usingSiteImages, opts.vertical);
    }
  }

  if (opts.dealer) {
    markDealerSampleSent(fs, path, opts.dealer, opts.csv);
  }

  console.log(`\nDone — ${results.length} clip(s) in outbound/samples/. DM message text is in the email body; paste it with the clip.`);
  process.exit(0);
}

async function emailSample(
  to: string,
  host: string,
  brand: string,
  lang: Lang,
  filePath: string,
  usedSiteImages: boolean,
  vertical: Vertical,
) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS.includes('PASTE')) {
    console.log('      email: SMTP not configured — clip is on disk');
    return;
  }
  const fs = await import('fs');
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  // Full-quality 24s renders regularly exceed the 20MB attachment cap, and
  // an email whose whole point is the clip must never arrive without it.
  // Compress a 720p copy for the attachment (DM platforms recompress anyway)
  // and keep the full-quality file on disk for direct sends.
  let attachPath = filePath;
  let bytes = fs.statSync(filePath).size;
  const LIMIT = 20 * 1024 * 1024;
  if (bytes > LIMIT) {
    const compressed = filePath.replace(/\.mp4$/, '.email.mp4');
    try {
      const { spawnSync } = await import('child_process');
      const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static') || 'ffmpeg';
      const result = spawnSync(ffmpeg, [
        '-y', '-i', filePath,
        '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
        '-c:v', 'libx264', '-crf', '28', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
        compressed,
      ], { encoding: 'utf8' });
      if (result.status === 0 && fs.existsSync(compressed)) {
        attachPath = compressed;
        bytes = fs.statSync(compressed).size;
        console.log(`      email: compressed for attachment (${Math.round(bytes / 1024 / 1024)}MB)`);
      }
    } catch (error) {
      console.warn('      email: compression failed, will fall back to path note:', error);
    }
  }
  const attach = bytes <= LIMIT;
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'ForgeVid <noreply@forgevid.com>',
      to,
      subject: `🎯 [PROSPECT] [${lang.toUpperCase()}] ${host}`,
      text:
        `DM message (copy-paste, then attach the clip):\n\n${DM_TEMPLATES[vertical][lang](brand)}\n\n` +
        (usedSiteImages
          ? 'Footage: THEIR OWN site images — lead with that in the conversation.'
          : 'Footage: stock fallback (their site blocked image downloads) — the words are still grounded in their site.') +
        (attach
          ? attachPath === filePath
            ? ''
            : `\n\nAttached is a 720p email copy — the full-quality file is at ${filePath}`
          : `\n\nClip too large to attach even compressed — it is at ${filePath}`),
      attachments: attach
        ? [{ filename: filePath.split(/[\\/]/).pop()!, path: attachPath, contentType: 'video/mp4' }]
        : [],
    });
    console.log(`      email: sent to ${to}${attach ? ' (clip attached)' : ' (NO ATTACHMENT)'}`);
  } catch (error) {
    console.error(`      email FAILED: ${error instanceof Error ? error.message : error}`);
  }
}

/** Split one CSV line respecting double-quoted fields (which contain commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function toCsvLine(cols: string[]): string {
  return cols.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}

/** Mark the dealer's row in outbound/dealers.csv: SAMPLE_SENT + today's date. */
function markDealerSampleSent(fs: any, path: any, dealerName: string, csvFile: string) {
  const csvPath = path.join(process.cwd(), 'outbound', csvFile);
  if (!fs.existsSync(csvPath)) {
    console.warn(`      tracker: outbound/${csvFile} not found — skipped`);
    return;
  }
  const lines: string[] = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  const needle = dealerName.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  let hit = false;
  const updated = lines.map((line: string, i: number) => {
    if (i === 0 || !line.trim()) return line;
    const cols = parseCsvLine(line);
    if (!hit && (cols[1] ?? '').toLowerCase().includes(needle)) {
      hit = true;
      if (cols[0] === 'NEW') cols[0] = 'SAMPLE_SENT';
      cols[14] = 'Y'; // sample_sent
      cols[15] = today; // sample_date
      return toCsvLine(cols);
    }
    return line;
  });
  if (hit) {
    fs.writeFileSync(csvPath, updated.join('\n'));
    console.log(`      tracker: "${dealerName}" marked SAMPLE_SENT (${today})`);
  } else {
    console.warn(`      tracker: no row matching "${dealerName}" — update dealers.csv by hand`);
  }
}

main().catch((e) => {
  console.error('\nSample failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
