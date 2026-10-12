/**
 * Against the local Redis (REDIS_URL from ../erp-infra/env/local/api.host.env) on QUEUE_REDIS_DB
 * (2, BE-14). Every case runs on its own `test.q-<uuid>` queue with the module options attempts 2,
 * base 10 ms, max 50 ms; `afterAll` closes every service, obliterates every queue and its DLQ, and
 * proves no `bull:test.q-*` key is left on db 2. Job data is synthetic ids only (T-4.2-18).
 */
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../config/app-config.js';
import { UpstreamUnavailableError } from '../../errors/upstream-unavailable.error.js';
import { LoggerService, type LogMeta } from '../../logger/logger.service.js';
import { Breaker } from '../../resilience/breaker.js';
import { isTransientError } from '../../resilience/transient-error.js';
import {
  DeferJobError,
  NonRetryableJobError,
  type JobProcessor,
  type QueueJob,
} from '../base.processor.js';
import { producerConnection, queueRedisUrl } from '../queue-connection.js';
import { DEAD_LETTER_SUFFIX, QUEUE_PREFIX, QueueService } from '../queue.service.js';

const POLL_MS = 25;
const WAIT_MS = 5_000;
const OPTIONS = { attempts: 2, baseDelayMs: 10, maxDelayMs: 50 };

/** Captures every line instead of printing it, so a case can prove what a log line holds. */
class CapturingLogger extends LoggerService {
  readonly lines: [string, LogMeta | undefined][] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push([message, meta]);
  }

  override warn(message: string, meta?: LogMeta): void {
    this.lines.push([message, meta]);
  }

  override error(message: string, meta?: LogMeta): void {
    this.lines.push([message, meta]);
  }
}

function transient(): Error {
  return Object.assign(new Error('reset'), { code: 'ECONNRESET' });
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${String(timeoutMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

describe.skipIf(!process.env.REDIS_URL)('QueueService against the local Redis (db 2)', () => {
  const config = new AppConfig();
  const redisUrl = config.env.REDIS_URL ?? '';
  const logger = new CapturingLogger();
  const services: QueueService[] = [];
  const inspectors = new Map<string, Queue>();
  const made: string[] = [];
  const breakers: Breaker[] = [];
  const raw = [0, 1, 2].map((db) => new Redis(queueRedisUrl(redisUrl, db), { db }));

  function newQueue(): string {
    const name = `test.q-${randomUUID()}`;
    made.push(name, `${name}${DEAD_LETTER_SUFFIX}`);
    return name;
  }

  function newService(runWorkers: boolean, options = OPTIONS): QueueService {
    const service = new QueueService(config, logger, { ...options, runWorkers });
    services.push(service);
    return service;
  }

  /** A plain BullMQ handle on the same queue, for reading counts and jobs. */
  function inspect(name: string): Queue {
    let queue = inspectors.get(name);
    if (queue === undefined) {
      const connection = producerConnection(config.env);
      if (connection === null) throw new Error('REDIS_URL is not set');
      queue = new Queue(name, { connection, prefix: QUEUE_PREFIX });
      inspectors.set(name, queue);
    }
    return queue;
  }

  async function count(name: string, state: 'completed' | 'failed' | 'waiting' | 'delayed') {
    return (await inspect(name).getJobCounts(state))[state] ?? 0;
  }

  const deadLetters = (name: string) => count(`${name}${DEAD_LETTER_SUFFIX}`, 'waiting');

  async function startWith(processor: JobProcessor, options = OPTIONS): Promise<QueueService> {
    const service = newService(true, options);
    service.registerProcessor(processor);
    await service.onApplicationBootstrap();
    return service;
  }

  afterAll(async () => {
    try {
      for (const service of services) await service.onModuleDestroy();
      for (const name of made) await inspect(name).obliterate({ force: true });
      for (const queue of inspectors.values()) await queue.close();
      const [db0, db1, db2] = raw;
      const left = await db2?.keys(`${QUEUE_PREFIX}:test.q-*`);
      expect(left, 'no bull:test.q-* key may be left on db 2').toEqual([]);
      expect(await db0?.keys(`${QUEUE_PREFIX}:test.q-*`)).toEqual([]);
      expect(await db1?.keys(`${QUEUE_PREFIX}:test.q-*`)).toEqual([]);
    } finally {
      for (const breaker of breakers) breaker.shutdown();
      for (const client of raw) await client.quit();
    }
  });

  it('writes bull:<queue>:* keys on db 2 only (BE-14, T-4.2-33)', async () => {
    const name = newQueue();
    await newService(false).add(name, 'probe', { id: 1 });
    const [db0, db1, db2] = raw;
    expect((await db2?.keys(`${QUEUE_PREFIX}:${name}:*`))?.length).toBeGreaterThan(0);
    expect(await db0?.keys(`${QUEUE_PREFIX}:${name}:*`)).toEqual([]);
    expect(await db1?.keys(`${QUEUE_PREFIX}:${name}:*`)).toEqual([]);
  });

  it('keeps one job for two adds with the same jobId', async () => {
    const name = newQueue();
    const service = newService(false);
    const first = await service.add(name, 'import', { runId: 1 }, { jobId: 'import-1' });
    const second = await service.add(name, 'import', { runId: 1 }, { jobId: 'import-1' });
    expect(second).toBe(first);
    expect(await count(name, 'waiting')).toBe(1);
  });

  it('retries a transient error and completes on the second attempt; the DLQ stays empty', async () => {
    const name = newQueue();
    let calls = 0;
    const service = await startWith({
      queue: name,
      handle: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(transient()) : Promise.resolve();
      },
    });
    await service.add(name, 'work', { id: 2 });
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(calls).toBe(2);
    expect(await deadLetters(name)).toBe(0);
  });

  it('dead-letters a NonRetryableJobError after one attempt, with ids and the reason, and logs no data', async () => {
    const name = newQueue();
    const marker = `marker-${randomUUID()}`;
    let calls = 0;
    const service = await startWith({
      queue: name,
      handle: () => {
        calls += 1;
        return Promise.reject(new NonRetryableJobError('cannot parse'));
      },
    });
    await service.add(name, 'import', { runId: 7, marker }, { jobId: 'import-7' });
    await waitFor(async () => (await deadLetters(name)) === 1);
    expect(calls).toBe(1);
    expect(await count(name, 'failed')).toBe(1);
    const [dead] = await inspect(`${name}${DEAD_LETTER_SUFFIX}`).getJobs(['waiting']);
    expect(dead?.data).toMatchObject({
      queue: name,
      jobId: 'import-7',
      name: 'import',
      reason: 'NonRetryableJobError',
      data: { runId: 7, marker },
    });
    expect(JSON.stringify(dead?.data)).not.toContain('cannot parse');
    expect(JSON.stringify(logger.lines)).not.toContain(marker);
    expect(logger.lines).toContainEqual([
      'job failed',
      { queue: name, jobId: 'import-7', name: 'import', attempt: 1, retryable: false },
    ]);
  });

  it('dead-letters an always-transient job after the module attempts (2), then replays it', async () => {
    const name = newQueue();
    let calls = 0;
    let healthy = false;
    const service = await startWith({
      queue: name,
      handle: () => {
        calls += 1;
        return healthy ? Promise.resolve() : Promise.reject(transient());
      },
    });
    const id = await service.add(name, 'work', { id: 3 });
    await waitFor(async () => (await deadLetters(name)) === 1);
    expect(calls).toBe(2);
    expect((await inspect(name).getJob(id))?.opts.attempts).toBe(2);

    healthy = true;
    expect(await service.replayDeadLetters(name, 10)).toBe(1);
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(calls).toBe(3);
    expect(await deadLetters(name)).toBe(0);
  });

  it('processes a job added while no worker ran once a worker starts (restart safety, B23)', async () => {
    const name = newQueue();
    await newService(false).add(name, 'work', { id: 4 });
    expect(await count(name, 'waiting')).toBe(1);
    let calls = 0;
    await startWith({
      queue: name,
      handle: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(calls).toBe(1);
  });

  it('runs a repeatable processor at least twice in 2 s and keeps one scheduler for two workers', async () => {
    const name = newQueue();
    let runs = 0;
    const processor: JobProcessor = {
      queue: name,
      repeatEveryMs: 50,
      handle: () => {
        runs += 1;
        return Promise.resolve();
      },
    };
    const first = await startWith(processor);
    await waitFor(() => runs >= 2, 2_000);
    const second = await startWith(processor);
    expect(await inspect(name).getJobSchedulersCount()).toBe(1);
    const [scheduler] = await inspect(name).getJobSchedulers();
    expect(scheduler?.key).toBe(`${name}.repeat`);
    await first.onModuleDestroy();
    await second.onModuleDestroy();
  });

  it("uses a processor's own retryPolicy over the module's (D-10): 3 attempts, then the DLQ", async () => {
    const name = newQueue();
    const observed: number[] = [];
    const service = await startWith({
      queue: name,
      retryPolicy: { attempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryOn: isTransientError },
      handle: (job: QueueJob<unknown>) => {
        observed.push(job.attemptsMade);
        return Promise.reject(transient());
      },
    });
    const id = await service.add(name, 'send', { id: 5 });
    expect((await inspect(name).getJob(id))?.opts.attempts).toBe(3);
    await waitFor(async () => (await deadLetters(name)) === 1);
    expect(observed).toEqual([0, 1, 2]);
  });

  it('defers without spending an attempt (D-10): observed attemptsMade [0, 0], no failure, no DLQ', async () => {
    const name = newQueue();
    const observed: number[] = [];
    const service = await startWith({
      queue: name,
      handle: (job: QueueJob<unknown>) => {
        observed.push(job.attemptsMade);
        return observed.length === 1 ? Promise.reject(new DeferJobError(30)) : Promise.resolve();
      },
    });
    await service.add(name, 'send', { id: 6 });
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(observed).toEqual([0, 0]);
    expect(await count(name, 'failed')).toBe(0);
    expect(await deadLetters(name)).toBe(0);
  });

  it('defers on the last attempt without dead-lettering: observed [0, 1, 1], then completes', async () => {
    const name = newQueue();
    const observed: number[] = [];
    const service = await startWith({
      queue: name,
      handle: (job: QueueJob<unknown>) => {
        observed.push(job.attemptsMade);
        if (observed.length === 1) return Promise.reject(transient());
        if (observed.length === 2) return Promise.reject(new DeferJobError(30));
        return Promise.resolve();
      },
    });
    await service.add(name, 'send', { id: 7 });
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(observed).toEqual([0, 1, 1]);
    expect(await deadLetters(name)).toBe(0);
  });

  it('defers while the breaker is open and completes once it closes; uncaught, the open breaker dead-letters', async () => {
    const breakerOptions = {
      volumeThreshold: 5,
      errorThresholdPercentage: 50,
      rollingWindowMs: 60_000,
      halfOpenAfterMs: 10_000,
    };
    const breaker = new Breaker('email', breakerOptions, logger);
    const control = new Breaker('email', breakerOptions, logger);
    breakers.push(breaker, control);
    breaker.forceOpen();
    control.forceOpen();
    let upstreamCalls = 0;
    const call = (): Promise<void> => {
      upstreamCalls += 1;
      return Promise.resolve();
    };

    const name = newQueue();
    const observed: number[] = [];
    const service = await startWith({
      queue: name,
      handle: async (job: QueueJob<unknown>) => {
        observed.push(job.attemptsMade);
        try {
          await breaker.execute(call);
        } catch (error) {
          if (error instanceof UpstreamUnavailableError) throw new DeferJobError(200);
          throw error;
        }
      },
    });
    const id = await service.add(name, 'send', { id: 8 });
    await waitFor(
      async () =>
        (await inspect(name).getJob(id))?.getState().then((s) => s === 'delayed') ?? false,
      2_000,
    );
    expect(upstreamCalls).toBe(0);
    expect(await count(name, 'failed')).toBe(0);
    expect(await deadLetters(name)).toBe(0);

    breaker.forceClose();
    await waitFor(async () => (await count(name, 'completed')) === 1);
    expect(upstreamCalls).toBe(1);
    expect(observed.every((made) => made === 0)).toBe(true);

    const uncaught = newQueue();
    let uncaughtCalls = 0;
    const plain = await startWith({
      queue: uncaught,
      handle: async () => {
        uncaughtCalls += 1;
        await control.execute(call);
      },
    });
    await plain.add(uncaught, 'send', { id: 9 });
    await waitFor(async () => (await deadLetters(uncaught)) === 1);
    expect(uncaughtCalls).toBe(1);
    const [dead] = await inspect(`${uncaught}${DEAD_LETTER_SUFFIX}`).getJobs(['waiting']);
    expect(dead?.data).toMatchObject({ reason: 'ERP-UPSTREAM-0001' });
  });
});
