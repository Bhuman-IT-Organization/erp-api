/**
 * The hourly `uploads.cleanup` job (P-12, ADR-0041 §7): removes tus uploads left unfinished past
 * their 24 h expiry, so abandoned partial uploads cannot fill the files volume (T-4.2-27). The
 * first repeatable job (D-45: Node defines its own schedules); it runs in the worker process and
 * logs the count only.
 */
import { Injectable } from '@nestjs/common';
import { TIMINGS } from '../config/timings.js';
import { LoggerService } from '../logger/logger.service.js';
import { BaseProcessor, ProcessorRegistry } from '../queue/base.processor.js';
import { UploadsService } from './uploads.service.js';

/** Runs `UploadsService.cleanUpExpired()` every `TIMINGS.uploads.cleanupEveryMs`. */
@Injectable()
export class UploadsCleanupProcessor extends BaseProcessor<Record<string, never>> {
  readonly queue = 'uploads.cleanup';
  readonly repeatEveryMs = TIMINGS.uploads.cleanupEveryMs;

  constructor(
    queues: ProcessorRegistry,
    private readonly uploads: UploadsService,
    private readonly logger: LoggerService,
  ) {
    super(queues);
  }

  async handle(): Promise<void> {
    const removed = await this.uploads.cleanUpExpired();
    this.logger.log('uploads cleaned', { removed });
  }
}
