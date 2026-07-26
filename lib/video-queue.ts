/**
 * BullMQ queue for video generation.
 *
 * Redis-optional: when REDIS_URL is set, generation jobs are enqueued and run
 * by a separate worker process (workers/video-worker.ts). When it is not, the
 * API route runs the job inline (fire-and-forget). Either way the HTTP request
 * returns immediately — the multi-minute pipeline never blocks the response.
 *
 * All env reads are lazy so the worker can load env (via @next/env) before
 * these functions are first called.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { GenerationInput } from './generation-pipeline';

export const GENERATION_QUEUE_NAME = 'video-generation';

/**
 * Two job kinds share one queue/worker:
 *  - generate: plan scenes, match footage, assemble
 *  - rerender: re-assemble from the scenes already persisted on the Video
 */
export type GenerationJobData =
  | { kind: 'generate'; videoId: string; userId: string; input: GenerationInput }
  | { kind: 'rerender'; videoId: string; userId: string };

let connection: IORedis | null = null;
let generationQueue: Queue<GenerationJobData> | null = null;

export function isQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Shared ioredis connection. `maxRetriesPerRequest: null` is required by BullMQ
 * for connections used by workers and blocking commands.
 */
export function getRedisConnection(): IORedis | null {
  if (!process.env.REDIS_URL) return null;
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getGenerationQueue(): Queue<GenerationJobData> | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  if (!generationQueue) {
    generationQueue = new Queue<GenerationJobData>(GENERATION_QUEUE_NAME, { connection: conn });
  }
  return generationQueue;
}

/**
 * Enqueue a job. Returns the BullMQ job id, or null if no queue is configured
 * (caller should then run the work inline).
 */
export async function enqueueJob(data: GenerationJobData): Promise<string | null> {
  const queue = getGenerationQueue();
  if (!queue) return null;
  const job = await queue.add(data.kind, data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 7 * 24 * 3600, count: 500 },
  });
  return job.id ?? null;
}

export function enqueueGeneration(args: {
  videoId: string;
  userId: string;
  input: GenerationInput;
}): Promise<string | null> {
  return enqueueJob({ kind: 'generate', ...args });
}

export function enqueueRerender(args: {
  videoId: string;
  userId: string;
}): Promise<string | null> {
  return enqueueJob({ kind: 'rerender', ...args });
}
