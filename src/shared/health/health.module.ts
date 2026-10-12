import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/** Global so any module can register a probe without importing this module. */
@Global()
@Module({ controllers: [HealthController], providers: [HealthService], exports: [HealthService] })
export class HealthModule {}
