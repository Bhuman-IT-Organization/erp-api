import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service.js';

/** Makes the redacting winston logger injectable everywhere; imported first in AppModule after ConfigModule. */
@Global()
@Module({ providers: [LoggerService], exports: [LoggerService] })
export class LoggerModule {}
