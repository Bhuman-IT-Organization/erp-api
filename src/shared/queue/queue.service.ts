/**
 * BullMQ on Redis db 2 (BE-14, ADR-0017), under the `bull` prefix, with one dead-letter queue
 * `<queue>.dlq` per queue. The api process enqueues (`runWorkers: false`); the worker process
 * (`worker.ts`, `runWorkers: true`) also starts one BullMQ `Worker` per registered processor and
 * upserts each repeatable schedule as `<queue>.repeat`.
 *
 * Retries: a queue's effective policy is its processor's own `retryPolicy` or the module policy
 * (`RETRY_POLICIES.queueJob`, Phase 4.3 D-10). Every job is added with that policy's `attempts`
 * and a custom backoff, `backoffDelayMs`, registered on the queue's `Worker`. A `NonRetryableJobError`
 * or an error the policy does not call transient fails at once; the last failed attempt adds
 * `{ queue, jobId, name, data, reason, failedAt }` to `<queue>.dlq` and throws BullMQ's
 * `UnrecoverableError`. `replayDeadLetters` puts dead jobs back.
 *
 * Deferral (Phase 4.3 D-10, T-4.2-37): a processor that throws `DeferJobError(delayMs)` has its
 * job moved back to delayed through `Job.moveToDelayed` and `DelayedError`: no attempt is spent and
 * nothing lands in the DLQ, whatever the attempt number.
 *
 * Ids only (T-4.2-18): log lines carry the queue, job id, job name, attempt and a reason; a DLQ
 * `reason` and the error BullMQ stores on the job are the `AppError` code or the error's name,
 * never its message, and job data is never logged. A custom `jobId` must not contain `:` and must
 * not be an integer string (BullMQ 6.3.10 refuses both); use `-`, e.g. `import-<runId>`.
 */
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DelayedError,
  Queue,
  UnrecoverableError,
  Worker,
  type Job,
  type RedisOptions,
} from 'bullmq';
import { AppConfig } from '../config/app-config.js';
import { RETRY_POLICIES, type RetryPolicy } from '../config/retry-policies.js';
import { TIMINGS } from '../config/timings.js';
import { AppError } from '../errors/app-error.js';
import { LoggerService } from '../logger/logger.service.js';
import { timeoutSignal } from '../resilience/timeout.js';
import {
  DeferJobError,
  NonRetryableJobError,
  ProcessorRegistry,
  type JobProcessor,
} from './base.processor.js';
import { producerConnection, workerConnection } from './queue-connection.js';

export const QUEUE_PREFIX = 'bull';
export const DEAD_LETTER_SUFFIX = '.dlq';
export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

/** The module policy's numbers and whether this process runs workers. */
export interface QueueModuleOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly runWorkers: boolean;
}

/** `<module>.<concern>`: lower case, at least one dot, no `:` (BullMQ key separator). */
const QUEUE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
/** BullMQ's own ids are integers; a custom id never is. */
const AUTO_ID = /^\d+$/;

/** One DLQ entry: what replay needs, and why it died (a code or an error name). */
interface DeadLetter {
  readonly queue: string;
  readonly jobId: string;
  readonly name: string;
  readonly data: unknown;
  readonly reason: string;
  readonly failedAt: string;
}

/** The capped exponential backoff: `min(max, base * 2 ** (attemptsMade - 1))`. */
export function backoffDelayMs(
  attemptsMade: number,
  policy: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'> = RETRY_POLICIES.queueJob,
): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptsMade - 1));
}

/** Retry only what the policy calls transient, and never a `NonRetryableJobError`. */
export function isRetryableJobError(
  error: unknown,
  policy: Pick<RetryPolicy, 'retryOn'> = RETRY_POLICIES.queueJob,
): boolean {
  return !(error instanceof NonRetryableJobError) && policy.retryOn(error);
}

/** A queue's effective policy: its processor's own, else the module's. */
export function retryPolicyOf(
  processor: JobProcessor | undefined,
  modulePolicy: RetryPolicy,
): RetryPolicy {
  return processor?.retryPolicy ?? modulePolicy;
}

/** The `AppError` code or the error's name; never a message (T-4.2-18). */
function reasonOf(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return error instanceof Error ? error.name : 'Error';
}

/** Enqueues jobs, registers processors, runs workers (worker process only) and replays the DLQ. */
@Injectable()
export class QueueService
  extends ProcessorRegistry
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly processors = new Map<string, JobProcessor>();
  private readonly queues = new Map<string, Queue>();
  private workers: Worker[] = [];
  private readonly modulePolicy: RetryPolicy;
  private readonly producer: RedisOptions | null;
  private readonly consumer: RedisOptions | null;

  constructor(
    config: AppConfig,
    private readonly logger: LoggerService,
    @Inject(QUEUE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {
    super();
    this.modulePolicy = {
      ...RETRY_POLICIES.queueJob,
      attempts: options.attempts,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
    };
    this.producer = producerConnection(config.env);
    this.consumer = workerConnection(config.env);
  }

  /** Enqueues a job; the same `jobId` twice keeps one job. Resolves to the job id. */
  async add(
    queue: string,
    name: string,
    data: unknown,
    options: { readonly jobId?: string; readonly delayMs?: number } = {},
  ): Promise<string> {
    const job = await this.queueOf(queue).add(name, data, {
      ...this.jobOptions(this.policyOf(queue)),
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
      ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
    });
    return job.id ?? '';
  }

  /** Called by `BaseProcessor.onModuleInit`. One processor per queue. */
  override registerProcessor(processor: JobProcessor): void {
    const { queue, retryPolicy } = processor;
    if (!QUEUE_NAME.test(queue)) {
      throw new Error(`queue name ${queue} must match ${QUEUE_NAME.source}`);
    }
    if (this.processors.has(queue)) throw new Error(`queue ${queue} already has a processor`);
    if (
      retryPolicy !== undefined &&
      !(Number.isInteger(retryPolicy.attempts) && retryPolicy.attempts >= 1)
    ) {
      throw new Error(`queue ${queue}: retryPolicy.attempts must be an integer >= 1 (T-4.2-34)`);
    }
    this.processors.set(queue, processor);
  }

  /** Puts up to `limit` dead jobs of `queue` back with fresh attempts; resolves to how many. */
  async replayDeadLetters(queue: string, limit: number): Promise<number> {
    if (limit < 1) return 0;
    const entries = await this.queueOf(`${queue}${DEAD_LETTER_SUFFIX}`).getJobs(
      ['waiting'],
      0,
      limit - 1,
      true,
    );
    await Promise.all(
      entries.map(async (entry) => {
        const letter = entry.data as DeadLetter;
        await (await this.queueOf(queue).getJob(letter.jobId))?.remove();
        await this.add(
          queue,
          letter.name,
          letter.data,
          AUTO_ID.test(letter.jobId) ? {} : { jobId: letter.jobId },
        );
        await entry.remove();
      }),
    );
    this.logger.log('dead letters replayed', { queue, replayed: entries.length });
    return entries.length;
  }

  /** Worker process only: one `Worker` per registered processor, then each repeatable schedule. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.runWorkers) return;
    const processors = [...this.processors.values()];
    this.workers.push(...processors.map((processor) => this.startWorker(processor)));
    const schedules = processors.flatMap(({ queue, repeatEveryMs }) =>
      repeatEveryMs === undefined ? [] : [{ queue, every: repeatEveryMs }],
    );
    await Promise.all(
      schedules.map(({ queue, every }) =>
        this.queueOf(queue).upsertJobScheduler(
          `${queue}.repeat`,
          { every },
          { name: 'repeat', data: {}, opts: this.jobOptions(this.policyOf(queue)) },
        ),
      ),
    );
  }

  /** Lets active jobs finish for `TIMINGS.queue.closeTimeoutMs`, then closes everything. */
  async onModuleDestroy(): Promise<void> {
    const workers = this.workers;
    this.workers = [];
    const deadline = timeoutSignal(TIMINGS.queue.closeTimeoutMs);
    const timedOut = new Promise<'timeout'>((resolve) => {
      deadline.addEventListener('abort', () => {
        resolve('timeout');
      });
    });
    const graceful = Promise.all(workers.map((worker) => worker.close())).then(() => 'closed');
    if ((await Promise.race([graceful, timedOut])) === 'timeout') {
      await Promise.all(workers.map((worker) => worker.close(true)));
    }
    const queues = [...this.queues.values()];
    this.queues.clear();
    await Promise.all(queues.map((queue) => queue.close()));
  }

  /** The names of the queues this process consumes or would consume. */
  registeredQueues(): string[] {
    return [...this.processors.keys()];
  }

  private policyOf(queue: string): RetryPolicy {
    return retryPolicyOf(this.processors.get(queue), this.modulePolicy);
  }

  private jobOptions(policy: RetryPolicy) {
    return {
      attempts: policy.attempts,
      backoff: { type: 'custom' },
      removeOnComplete: { age: TIMINGS.queue.keepCompletedS },
      removeOnFail: { age: TIMINGS.queue.keepFailedS },
    };
  }

  private queueOf(name: string): Queue {
    let queue = this.queues.get(name);
    if (queue === undefined) {
      if (this.producer === null) throw new Error('queue: REDIS_URL is not set');
      queue = new Queue(name, { connection: this.producer, prefix: QUEUE_PREFIX });
      queue.on('error', (error: Error) => {
        this.logger.warn('queue error', { queue: name, error: error.name });
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private startWorker(processor: JobProcessor): Worker {
    const policy = this.policyOf(processor.queue);
    if (this.consumer === null) throw new Error('queue: REDIS_URL is not set');
    const worker = new Worker(
      processor.queue,
      (job: Job, token?: string) => this.run(processor, policy, job, token),
      {
        connection: this.consumer,
        prefix: QUEUE_PREFIX,
        concurrency: processor.concurrency ?? 1,
        settings: {
          backoffStrategy: (attemptsMade: number) => backoffDelayMs(attemptsMade, policy),
        },
      },
    );
    worker.on('error', (error: Error) => {
      this.logger.warn('worker error', { queue: processor.queue, error: error.name });
    });
    return worker;
  }

  /** The processor function around `handle`: defer first, then retry or the DLQ. */
  private async run(
    processor: JobProcessor,
    policy: RetryPolicy,
    job: Job,
    token: string | undefined,
  ): Promise<void> {
    const ids = { queue: processor.queue, jobId: job.id ?? '', name: job.name };
    const attempt = job.attemptsMade + 1;
    try {
      await processor.handle({
        id: ids.jobId,
        name: job.name,
        data: job.data as unknown,
        attemptsMade: job.attemptsMade,
      });
      this.logger.log('job done', ids);
    } catch (error) {
      if (error instanceof DeferJobError) {
        this.logger.warn('job deferred', { ...ids, attempt, delayMs: error.delayMs });
        await job.moveToDelayed(Date.now() + error.delayMs, token);
        throw new DelayedError();
      }
      const retryable = isRetryableJobError(error, policy);
      this.logger.warn('job failed', { ...ids, attempt, retryable });
      const reason = reasonOf(error);
      // job.opts.attempts guards a job added by a process that saw another policy: BullMQ stops there.
      const attempts = Math.min(policy.attempts, job.opts.attempts ?? 1);
      if (retryable && attempt < attempts) throw new Error(reason);
      const letter: DeadLetter = {
        ...ids,
        data: job.data as unknown,
        reason,
        failedAt: new Date().toISOString(),
      };
      await this.queueOf(`${processor.queue}${DEAD_LETTER_SUFFIX}`).add(ids.name, letter);
      throw new UnrecoverableError(reason);
    }
  }
}
