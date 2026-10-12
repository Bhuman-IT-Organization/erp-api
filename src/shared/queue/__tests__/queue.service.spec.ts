/**
 * The queue's pure rules (BE-14): the capped backoff, the retry classification, the per-processor
 * policy (Phase 4.3 D-10), the defer error's guard, and what `registerProcessor` refuses. No Redis:
 * the service is built with no `REDIS_URL`, so it opens nothing.
 */
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { AppError } from '../../errors/app-error.js';
import { LoggerService } from '../../logger/logger.service.js';
import { isTransientError } from '../../resilience/transient-error.js';
import { RETRY_POLICIES } from '../../config/retry-policies.js';
import { TIMINGS } from '../../config/timings.js';
import {
  BaseProcessor,
  DeferJobError,
  NonRetryableJobError,
  ProcessorRegistry,
  type JobProcessor,
} from '../base.processor.js';
import { producerConnection, workerConnection } from '../queue-connection.js';
import { QueueModule } from '../queue.module.js';
import {
  backoffDelayMs,
  isRetryableJobError,
  QUEUE_OPTIONS,
  QueueService,
  retryPolicyOf,
} from '../queue.service.js';

/** A mail-like policy, spec-local: `RETRY_POLICIES.mailSend` is 04.3-02's. */
const MAIL_LIKE = {
  attempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 1_800_000,
  retryOn: isTransientError,
};

const MODULE_POLICY = { attempts: 2, baseDelayMs: 10, maxDelayMs: 50, retryOn: isTransientError };

const handle = (): Promise<void> => Promise.resolve();

function service(runWorkers = false): QueueService {
  const config = { env: { NODE_ENV: 'test', QUEUE_REDIS_DB: 2 } } as unknown as AppConfig;
  return new QueueService(config, new LoggerService(), {
    attempts: 2,
    baseDelayMs: 10,
    maxDelayMs: 50,
    runWorkers,
  });
}

describe('backoffDelayMs', () => {
  it('doubles from the base and caps at the max with the default policy (queueJob)', () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(7)).toBe(60_000);
  });

  it("uses a processor's own policy when given one", () => {
    expect(backoffDelayMs(2, MAIL_LIKE)).toBe(60_000);
    expect(backoffDelayMs(8, MAIL_LIKE)).toBe(1_800_000);
  });
});

describe('isRetryableJobError', () => {
  it('refuses a NonRetryableJobError, a plain Error and an AppError', () => {
    expect(isRetryableJobError(new NonRetryableJobError('bad file'))).toBe(false);
    expect(isRetryableJobError(new Error('x'))).toBe(false);
    expect(isRetryableJobError(new AppError('ERP-CORE-0004'))).toBe(false);
  });

  it('retries an error the policy calls transient (ECONNRESET)', () => {
    expect(isRetryableJobError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(
      true,
    );
  });

  it("follows the given policy's retryOn, but never retries a NonRetryableJobError", () => {
    expect(isRetryableJobError(new Error('x'), { retryOn: () => true })).toBe(true);
    expect(isRetryableJobError(new NonRetryableJobError('x'), { retryOn: () => true })).toBe(false);
  });
});

describe('retryPolicyOf', () => {
  it('is the module policy unless the processor sets its own (D-10)', () => {
    expect(retryPolicyOf(undefined, MODULE_POLICY)).toBe(MODULE_POLICY);
    expect(retryPolicyOf({ queue: 'a.b', handle }, MODULE_POLICY)).toBe(MODULE_POLICY);
    expect(retryPolicyOf({ queue: 'a.b', handle, retryPolicy: MAIL_LIKE }, MODULE_POLICY)).toBe(
      MAIL_LIKE,
    );
  });
});

describe('DeferJobError', () => {
  it('carries its delay and its name', () => {
    const error = new DeferJobError(30_000);
    expect(error.delayMs).toBe(30_000);
    expect(error.name).toBe('DeferJobError');
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses a delay of %s (T-4.2-37)', (delayMs) => {
    expect(() => new DeferJobError(delayMs)).toThrow(RangeError);
  });
});

describe('QueueService.registerProcessor', () => {
  it('refuses a second processor for the same queue', () => {
    const queues = service();
    queues.registerProcessor({ queue: 'mail.send', handle });
    expect(() => {
      queues.registerProcessor({ queue: 'mail.send', handle });
    }).toThrow(/mail\.send/);
  });

  it.each(['send', 'Mail.send', 'mail.', 'mail.send:x', '1a.b'])(
    'refuses the queue name %s',
    (queue) => {
      expect(() => {
        service().registerProcessor({ queue, handle });
      }).toThrow(/queue name/);
    },
  );

  it.each([0, 1.5])('refuses a retryPolicy with attempts %s (T-4.2-34)', (attempts) => {
    const processor: JobProcessor = {
      queue: 'mail.send',
      handle,
      retryPolicy: { ...MAIL_LIKE, attempts },
    };
    expect(() => {
      service().registerProcessor(processor);
    }).toThrow(/attempts/);
  });

  it('accepts a processor with its own policy', () => {
    expect(() => {
      service().registerProcessor({ queue: 'mail.send', handle, retryPolicy: MAIL_LIKE });
    }).not.toThrow();
  });
});

describe('QueueService without REDIS_URL (the unit suite)', () => {
  it('rejects add without opening a connection', async () => {
    await expect(service().add('mail.send', 'send', { mailId: 1 })).rejects.toThrow(
      'queue: REDIS_URL is not set',
    );
  });

  it('closes cleanly when nothing was opened', async () => {
    await expect(service().onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('queue connections (BE-14, RESEARCH Pitfall 4)', () => {
  const env = { REDIS_URL: 'redis://127.0.0.1:63791/0', QUEUE_REDIS_DB: 2 };

  it('puts both on QUEUE_REDIS_DB, in the URL path too (the path wins in ioredis)', () => {
    expect(producerConnection(env)).toMatchObject({ url: 'redis://127.0.0.1:63791/2', db: 2 });
    expect(workerConnection(env)).toMatchObject({ url: 'redis://127.0.0.1:63791/2', db: 2 });
  });

  it('fails fast on the producer and blocks without a retry cap on the worker', () => {
    expect(producerConnection(env)).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: TIMINGS.redis.maxRetriesPerRequest,
    });
    const worker = workerConnection(env);
    expect(worker?.maxRetriesPerRequest).toBeNull();
    expect(worker?.enableOfflineQueue).toBeUndefined();
  });

  it('opens nothing without REDIS_URL', () => {
    expect(producerConnection({ QUEUE_REDIS_DB: 2 })).toBeNull();
    expect(workerConnection({ QUEUE_REDIS_DB: 2 })).toBeNull();
  });
});

describe('QueueModule.forRoot', () => {
  it('is global, with the queueJob numbers and the runWorkers flag as QUEUE_OPTIONS', () => {
    const module = QueueModule.forRoot({ runWorkers: true });
    expect(module.global).toBe(true);
    expect(module.exports).toEqual([QueueService, ProcessorRegistry]);
    expect(module.providers).toContainEqual({
      provide: QUEUE_OPTIONS,
      useValue: {
        attempts: RETRY_POLICIES.queueJob.attempts,
        baseDelayMs: RETRY_POLICIES.queueJob.baseDelayMs,
        maxDelayMs: RETRY_POLICIES.queueJob.maxDelayMs,
        runWorkers: true,
      },
    });
  });
});

describe('BaseProcessor', () => {
  class DemoProcessor extends BaseProcessor<{ readonly id: number }> {
    readonly queue = 'demo.work';

    handle(): Promise<void> {
      return Promise.resolve();
    }
  }

  it('registers itself on module init, with no retryPolicy of its own', () => {
    const queues = service();
    const processor = new DemoProcessor(queues);
    processor.onModuleInit();
    expect(queues.registeredQueues()).toEqual(['demo.work']);
    expect(processor.retryPolicy).toBeUndefined();
  });
});

describe('QueueService lifecycle without REDIS_URL', () => {
  it('starts no worker when runWorkers is false', async () => {
    const queues = service(false);
    queues.registerProcessor({ queue: 'demo.work', handle });
    await expect(queues.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('refuses to run workers it cannot connect', async () => {
    const queues = service(true);
    queues.registerProcessor({ queue: 'demo.work', handle });
    await expect(queues.onApplicationBootstrap()).rejects.toThrow('queue: REDIS_URL is not set');
  });

  it('replays nothing for a limit under 1', async () => {
    await expect(service().replayDeadLetters('demo.work', 0)).resolves.toBe(0);
  });
});
