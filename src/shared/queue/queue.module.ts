/**
 * The queue module (BE-14): global, so any module's processor or service reaches `QueueService`.
 * `AppModule` imports `forRoot({ runWorkers: false })` (it enqueues), `WorkerModule`
 * `forRoot({ runWorkers: true })` (it also runs the workers). The module policy is
 * `RETRY_POLICIES.queueJob`; a processor may set its own (Phase 4.3 D-10).
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { RETRY_POLICIES } from '../config/retry-policies.js';
import { ProcessorRegistry } from './base.processor.js';
import { QUEUE_OPTIONS, QueueService, type QueueModuleOptions } from './queue.service.js';

/** Provides `QueueService`, also as the `ProcessorRegistry` `BaseProcessor` registers with. */
@Module({})
export class QueueModule {
  static forRoot(options: { readonly runWorkers: boolean }): DynamicModule {
    const { attempts, baseDelayMs, maxDelayMs } = RETRY_POLICIES.queueJob;
    const value: QueueModuleOptions = { attempts, baseDelayMs, maxDelayMs, ...options };
    return {
      module: QueueModule,
      global: true,
      providers: [
        { provide: QUEUE_OPTIONS, useValue: value },
        QueueService,
        { provide: ProcessorRegistry, useExisting: QueueService },
      ],
      exports: [QueueService, ProcessorRegistry],
    };
  }
}
