/**
 * The processor contract of `shared/queue/` (BE-14). A module's job is `v1/<m>/jobs/<name>.job.ts`
 * (the zod data schema, ids only, T-4.2-18, and an `enqueue...` helper calling `QueueService.add`)
 * plus `v1/<m>/jobs/<name>.processor.ts`: an `@Injectable()` class extending `BaseProcessor`,
 * listed in the module's providers. It registers itself with the queue service on module init;
 * the worker process (`worker.ts`) runs it, the api process only enqueues.
 *
 * Failure: a parse or validation failure throws `NonRetryableJobError` (the DLQ at once); an error
 * the queue's retry policy calls transient retries with capped backoff; the last failed attempt
 * lands in `<queue>.dlq`. A processor may set its own `retryPolicy` (Phase 4.3 D-10); without one
 * it gets the module policy, `RETRY_POLICIES.queueJob`.
 *
 * `ProcessorRegistry` is the abstract class `QueueService` is provided as: `BaseProcessor` depends
 * on it rather than on `QueueService` itself, because `queue.service.ts` imports the errors and
 * types below and the other direction would be an import cycle.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { RetryPolicy } from '../config/retry-policies.js';

/** The job cannot succeed however often it runs (a file that cannot be parsed): fail at once into the DLQ. */
export class NonRetryableJobError extends Error {
  override readonly name = 'NonRetryableJobError';
}

/**
 * Re-delays this job by `delayMs` WITHOUT spending an attempt and without the DLQ (Phase 4.3 D-10):
 * the worker moves it back to delayed through BullMQ's `moveToDelayed` and `DelayedError`.
 *
 * Only for an upstream known to be down (an open breaker, re-probed every
 * `TIMINGS.breaker.halfOpenAfterMs`, or an upstream's Retry-After), never for the job's own error:
 * a deferred job never reaches the DLQ, so deferring its own failure would retry it forever
 * (T-4.2-37). A delay that is not a positive integer is refused, so it cannot busy-loop.
 */
export class DeferJobError extends Error {
  override readonly name = 'DeferJobError';

  constructor(readonly delayMs: number) {
    super('job deferred');
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) {
      throw new RangeError('DeferJobError: delayMs must be a positive integer');
    }
  }
}

/** What a processor sees of a job. `attemptsMade` counts attempts spent; a defer spends none. */
export interface QueueJob<Data> {
  readonly id: string;
  readonly name: string;
  readonly data: Data;
  readonly attemptsMade: number;
}

/** One queue's consumer. */
export interface JobProcessor<Data = unknown> {
  /** `<module>.<concern>`, e.g. `mail.send`: lower case, at least one dot, never `:`. */
  readonly queue: string;
  /** Jobs run at once by one worker; default 1 (two imports against one item master is the legacy failure mode). */
  readonly concurrency?: number;
  /** When set, the worker upserts the scheduler `<queue>.repeat` firing every that many ms (D-45). */
  readonly repeatEveryMs?: number;
  /** This queue's attempts, backoff and classification; absent: the module policy (`RETRY_POLICIES.queueJob`). */
  readonly retryPolicy?: RetryPolicy;
  handle(job: QueueJob<Data>): Promise<void>;
}

/** Where processors register; `QueueService` is provided under this class (see the file docblock). */
export abstract class ProcessorRegistry {
  abstract registerProcessor(processor: JobProcessor): void;
}

/**
 * Extend this for a module's processor: set `queue` (and `concurrency`, `repeatEveryMs` or
 * `retryPolicy` when needed), implement `handle`, list the class in the module's providers.
 */
@Injectable()
export abstract class BaseProcessor<Data> implements JobProcessor<Data>, OnModuleInit {
  abstract readonly queue: string;
  readonly retryPolicy?: RetryPolicy;

  constructor(protected readonly queues: ProcessorRegistry) {}

  abstract handle(job: QueueJob<Data>): Promise<void>;

  onModuleInit(): void {
    this.queues.registerProcessor(this);
  }
}
