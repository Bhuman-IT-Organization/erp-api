import { Injectable } from '@nestjs/common';
import { loadEnv, type Env } from './env.schema.js';

/** Typed, validated environment. Fails fast at construction on a bad or missing variable (ADR-0014). */
@Injectable()
export class AppConfig {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }
}
