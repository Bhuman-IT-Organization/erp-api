import { Module } from '@nestjs/common';
import { SHARED_IMPORTS } from './app.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { QueueModule } from './shared/queue/queue.module.js';
import { V1Module } from './v1/v1.module.js';

/**
 * Root module of the worker process (BE-14): the api's shared modules, the queue running its
 * workers, and V1Module so every module's processors register here as they do in the api.
 */
@Module({
  imports: [
    ...SHARED_IMPORTS,
    QueueModule.forRoot({ runWorkers: true }),
    V1Module,
    IntegrationsModule,
  ],
})
export class WorkerModule {}
