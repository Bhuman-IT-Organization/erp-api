/**
 * Resumable uploads (ADR-0041): the tus endpoint, the service and the purpose registry. Global, so
 * a module registers its purpose in `onModuleInit` by injecting `UploadPurposeRegistry`. The hourly
 * `uploads.cleanup` job (`UploadsCleanupProcessor`, P-12) runs in the worker process.
 */
import { Global, Module } from '@nestjs/common';
import { TIMINGS } from '../config/timings.js';
import { UploadPurposeRegistry } from './upload-purpose.js';
import { UploadsCleanupProcessor } from './uploads-cleanup.processor.js';
import { UploadsController } from './uploads.controller.js';
import { UPLOADS_OPTIONS, UploadsService, type UploadsOptions } from './uploads.service.js';

const DEFAULT_OPTIONS: UploadsOptions = { expiryMs: TIMINGS.uploads.incompleteExpiryMs };

/** Provides the registry and the service; serves `/api/v1/uploads`. */
@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    UploadPurposeRegistry,
    UploadsService,
    UploadsCleanupProcessor,
    { provide: UPLOADS_OPTIONS, useValue: DEFAULT_OPTIONS },
  ],
  exports: [UploadPurposeRegistry, UploadsService],
})
export class UploadsModule {}
