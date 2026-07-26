/**
 * LIVE provider verification — the first run against the real APIs.
 *
 * Needs ELEVENLABS_API_KEY and/or HEYGEN_API_KEY in .env.local. Deliberately
 * cheap: it lists resources, synthesizes ~70 characters of speech (fractions of
 * a cent of TTS quota), and renders one short local video with that narration.
 * It does NOT start a HeyGen avatar render (those bill real credits) — that
 * stays a one-click opt-in from the UI.
 *
 *   npm run verify:providers
 */

import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function checkElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.log('\nElevenLabs: no key — skipped');
    return false;
  }
  console.log('\nChecking ElevenLabs (live)...');

  // 1. Cheap key validation: list voices.
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key },
  });
  assert(res.status !== 401, 'key is accepted (not 401)');
  assert(res.ok, `voice list responds (${res.status})`);
  const data: any = await res.json();
  const count = Array.isArray(data?.voices) ? data.voices.length : 0;
  assert(count > 0, `account has ${count} voices available`);

  // 2. Real synthesis through OUR pipeline path (per-scene + cache).
  const { synthesizeSceneVoiceovers, probeAudioSeconds } = await import('../lib/voiceover');
  const segments = await synthesizeSceneVoiceovers([
    { id: 'scene-1', description: 'ForgeVid live check, part one.' },
    { id: 'scene-2', description: 'And this is part two.' },
  ]);
  assert(!!segments && segments.length === 2, 'per-scene synthesis returned both segments');
  for (const s of segments!) {
    assert(s.durationSeconds > 0.3, `${s.sceneId}: real speech audio (${s.durationSeconds.toFixed(2)}s)`);
    assert(probeAudioSeconds(s.path) > 0.3, `${s.sceneId}: cache file is playable`);
  }

  // 3. Second call must be free (cache) — the re-render cost guarantee, live.
  const again = await synthesizeSceneVoiceovers([
    { id: 'scene-1', description: 'ForgeVid live check, part one.' },
    { id: 'scene-2', description: 'And this is part two.' },
  ]);
  assert(again!.every((s) => s.cached), 'repeat synthesis served entirely from cache (no charge)');
  return true;
}

async function renderWithRealVoice() {
  console.log('\nRendering a real video with the live narration...');
  // Railway also injects Cloudinary. This render verifies ElevenLabs + ffmpeg,
  // so keep the audit artifact local and avoid leaving production test media.
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  const { execFileSync } = await import('child_process');
  const fs = await import('fs');
  const path = await import('path');
  const { resolveFfmpegPath } = await import('../lib/ffmpeg-env');
  const { assembleVideo } = await import('../lib/video-generator');

  const ffmpegPath = resolveFfmpegPath();
  const workDir = path.join(process.cwd(), 'public', 'temp', 'verify-providers');
  fs.mkdirSync(workDir, { recursive: true });
  const clip = path.join(workDir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=teal:s=640x360:r=24', '-t', '6', '-pix_fmt', 'yuv420p', clip], { stdio: 'pipe' });

  const { videoUrl, scenes, cues } = await assembleVideo(
    [
      { id: 'scene-1', index: 0, description: 'ForgeVid live check, part one.', keywords: [], duration: 5, visualElements: [], clipUrl: clip, matchedQuery: 'test' },
      { id: 'scene-2', index: 1, description: 'And this is part two.', keywords: [], duration: 5, visualElements: [], clipUrl: clip, matchedQuery: 'test' },
    ],
    [], // all add-ons: voiceover + subtitles
    '16:9',
    { transition: null },
  );

  const outFile = path.join(process.cwd(), 'public', 'generated', path.basename(videoUrl));
  assert(fs.existsSync(outFile), 'video rendered');

  let info = '';
  try {
    execFileSync(ffmpegPath, ['-i', outFile], { stdio: 'pipe' });
  } catch (err: any) {
    info = String(err.stderr ?? '');
  }
  assert(/Stream .*Audio: aac/.test(info), 'output carries the REAL narration audio');
  // The requested length is a promise. Real ElevenLabs speech (~2s a line) is
  // shorter than these 5s scenes, and the video must still be 5s + 5s — the
  // spare time becomes a pause, not a shorter video.
  assert(
    scenes.every((s) => Math.abs(s.duration - 5) < 0.01),
    `the requested 5s scenes are honoured (${scenes.map((s) => s.duration.toFixed(2)).join('s, ')}s)`,
  );
  assert(
    Math.abs(cues[1].start - 5) < 0.05,
    `line 2 is spoken when scene 2 begins, not early (cue at ${cues[1].start.toFixed(2)}s)`,
  );
  assert(cues.length === 2, 'speech-aligned cues came from the segments');
  console.log(`      kept for listening: ${outFile}`);
}

async function checkOpenAI() {
  const { hasOpenAiKey, openAiApiKey } = await import('../lib/openai-key');
  if (!hasOpenAiKey()) {
    console.log('\nOpenAI: no key — skipped');
    return false;
  }
  console.log('\nChecking OpenAI (live)...');

  // Tiny completion (~20 tokens) validates the key and the model we use.
  const { OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: openAiApiKey() });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 5,
  });
  const reply = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
  assert(reply.includes('ok'), `chat completion works (reply: "${reply}")`);

  // Whisper, through OUR caption path, on a KNOWN real-speech segment (~2s,
  // ~$0.0002). The cache also holds sine-tone artifacts from the injectable-
  // synth tests, so we address the exact file by its content hash rather than
  // grabbing whatever sorts first.
  const fs = await import('fs');
  const path = await import('path');
  const { sceneCacheKey } = await import('../lib/voiceover');
  const { DEFAULT_VOICE_ID } = await import('../lib/voice-catalog');
  const knownLine = 'ForgeVid live check, part one.';
  const speechFile = path.join(
    process.cwd(),
    '.cache',
    'tts',
    `${sceneCacheKey(knownLine, DEFAULT_VOICE_ID)}.mp3`,
  );
  if (fs.existsSync(speechFile)) {
    const { transcribeAudioToText } = await import('../lib/captions');
    const text = (await transcribeAudioToText(speechFile)) ?? '';
    assert(
      /part one/i.test(text) || /forge/i.test(text),
      `Whisper transcribed the actual words: "${text}"`,
    );
  } else {
    console.log('      (known speech segment not cached yet — Whisper check skipped)');
  }
  return true;
}

async function checkGemini() {
  const { geminiApiKey, createLlmClient, llmModel } = await import('../lib/ai/llm');
  if (!geminiApiKey()) {
    console.log('\nGemini: no key — skipped');
    return false;
  }
  console.log('\nChecking Gemini (live)...');

  const previousProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = 'gemini';
  try {
    const gemini = createLlmClient();
    const completion = await gemini.chat.completions.create({
      model: llmModel('fast'),
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      // Current Gemini compat models may consume a few tokens internally
      // before emitting visible text, so five tokens can yield a successful
      // response with an empty message.
      max_tokens: 64,
    });
    const reply = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
    if (!reply) {
      console.log('      Gemini diagnostic:', JSON.stringify({
        model: completion.model,
        finishReason: completion.choices[0]?.finish_reason,
        refusal: completion.choices[0]?.message?.refusal,
        usage: completion.usage,
      }));
    }
    assert(reply.includes('ok'), `Gemini completion works (reply: "${reply}")`);
    return true;
  } finally {
    if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousProvider;
  }
}

async function checkPexels() {
  if (!process.env.PEXELS_API_KEY) {
    console.log('\nPexels: no key — skipped');
    return false;
  }
  console.log('\nChecking Pexels (live)...');
  const { searchStockVideos, searchStockPhotos } = await import('../lib/video-generator');

  const clips = await searchStockVideos('ocean waves', 3);
  assert(clips.length > 0, `video search returns footage (${clips.length} clips)`);
  assert(/^https?:\/\//.test(clips[0].url), 'clip urls are real remote media');

  const photos = await searchStockPhotos('mountain sunrise', 3);
  assert(photos.length > 0, `photo search returns stills (${photos.length} photos)`);
  return true;
}

/**
 * The milestone: a PROMPT becomes a narrated stock-footage video, live —
 * GPT plans the scenes, Pexels supplies the footage, ElevenLabs narrates,
 * ffmpeg assembles with speech-aligned captions and narration pacing.
 */
async function generateFromPrompt() {
  console.log('\nFIRST FULL PROMPT -> VIDEO (live GPT + Pexels + ElevenLabs)...');
  const { generateVideoWithScenes } = await import('../lib/video-generator');
  const fs = await import('fs');
  const path = await import('path');

  const { videoUrl, scenes, cues } = await generateVideoWithScenes({
    prompt:
      'A calm 10-second video about starting the day well: sunrise over the sea, ' +
      'a fresh cup of coffee, a person opening a laptop ready to work.',
    style: 'modern',
    duration: 10,
    addOns: [], // everything on: narration + captions
    aspectRatio: '16:9',
    transition: { type: 'fade', duration: 0.4 },
  });

  assert(scenes.length >= 2, `GPT planned ${scenes.length} scenes from the prompt`);
  assert(
    scenes.every((s) => /^https?:\/\//.test(s.clipUrl)),
    'every scene matched real Pexels footage',
  );
  assert(cues.length >= 2, 'speech-aligned captions were produced');

  const isRemote = /^https?:\/\//.test(videoUrl);
  const outFile = isRemote
    ? null
    : path.join(process.cwd(), 'public', 'generated', path.basename(videoUrl));
  if (outFile) {
    assert(fs.existsSync(outFile), 'the video exists on disk');
    console.log(`      WATCH IT: ${outFile}`);
  } else {
    console.log(`      WATCH IT: ${videoUrl}`);
  }
  for (const s of scenes) {
    console.log(
      `      ${s.id} (${s.duration.toFixed(2)}s, ${s.mediaType ?? 'video'}): "${s.description.slice(0, 70)}" [${s.matchedQuery}]`,
    );
  }
}

async function checkHeyGen() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    console.log('\nHeyGen: no key — skipped');
    return false;
  }
  console.log('\nChecking HeyGen (live)...');
  const { listAvatars } = await import('../lib/avatar-provider');
  const avatars = await listAvatars();
  assert(avatars.length > 0, `account lists ${avatars.length} avatars`);
  assert(!!avatars[0].avatarId && !!avatars[0].name, `first avatar: "${avatars[0].name}"`);
  console.log('      (no render started — avatar renders bill real credits; use the UI)');
  return true;
}

async function main() {
  const el = await checkElevenLabs();
  if (el) await renderWithRealVoice();
  const oa = await checkOpenAI();
  const gemini = await checkGemini();
  const px = await checkPexels();
  const heygen = await checkHeyGen();
  assert(el && oa && gemini && px && heygen, 'all five production providers are configured and live');
  // The full loop needs all three creative providers.
  if (el && oa && px) await generateFromPrompt();
  console.log('\nPASS — live provider checks complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAIL:', err.message);
    process.exit(1);
  });
