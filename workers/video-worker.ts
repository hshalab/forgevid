/**
 * Standalone BullMQ worker for video generation.
 *
 * Run separately from the Next.js server:  npm run worker
 * Requires REDIS_URL (plus the same OPENAI/PEXELS/ELEVENLABS/CLOUDINARY/DATABASE
 * env the app uses). If REDIS_URL is not set, generation runs inline in the API
 * route instead and this worker is not needed.
 *
 * Env is loaded via @next/env (same .env.local resolution as Next), and the
 * queue/pipeline modules are imported dynamically AFTER env load so their reads
 * see the configured values.
 */

import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const { Worker } = await import('bullmq');
  const { getRedisConnection, GENERATION_QUEUE_NAME } = await import('../lib/video-queue');
  const { runGeneration, rerenderVideo } = await import('../lib/generation-pipeline');
  const { prisma } = await import('../lib/prisma');

  const connection = getRedisConnection();
  if (!connection) {
    console.error('[worker] REDIS_URL is not set — cannot start the generation worker.');
    process.exit(1);
  }

  const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);

  // Observability: capture render failures in Sentry when a DSN is configured.
  const Sentry = process.env.SENTRY_DSN ? await import('@sentry/node') : null;
  Sentry?.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });

  const worker = new Worker<import('../lib/video-queue').GenerationJobData>(
    GENERATION_QUEUE_NAME,
    async (job) => {
      const { kind, videoId } = job.data;
      console.log(`[worker] job ${job.id} ${kind} video ${videoId}`);
      const url =
        job.data.kind === 'rerender'
          ? await rerenderVideo(videoId)
          : await runGeneration(videoId, job.data.input);
      console.log(`[worker] job ${job.id} done -> ${url}`);
      return { url };
    },
    { connection, concurrency },
  );

  worker.on('completed', (job) => console.log(`[worker] completed ${job.id}`));
  worker.on('failed', async (job, err) => {
    console.error(`[worker] failed ${job?.id}: ${err?.message}`);
    Sentry?.captureException(err, {
      tags: { videoId: job?.data?.videoId, kind: job?.data?.kind },
    });
    if (job && job.attemptsMade >= Number(job.opts.attempts || 1)) {
      await prisma.generationDeadLetter.create({
        data: {
          userId: job.data.userId,
          videoId: job.data.videoId,
          kind: job.data.kind,
          jobData: JSON.stringify(job.data),
          error: String(err?.message || 'Generation failed').slice(0, 2000),
          attempts: job.attemptsMade,
        },
      }).catch((recordError) => console.error('[worker] could not persist dead letter:', recordError));
    }
  });

  console.log(`[worker] listening on "${GENERATION_QUEUE_NAME}" (concurrency ${concurrency})`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, closing...`);
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
