import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';
import { ModuleSwitch } from './modules.js';

/** Makes the validated environment and the module switch (ADR-0042) injectable everywhere. */
@Global()
@Module({ providers: [AppConfig, ModuleSwitch], exports: [AppConfig, ModuleSwitch] })
export class ConfigModule {}
