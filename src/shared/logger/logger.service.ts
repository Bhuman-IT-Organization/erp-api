/**
 * The one logger (approved plan: winston, JSON lines with a timestamp). Every line written inside
 * a request scope carries `requestId` (and `staffId` once `JwtAuthGuard` has run) from
 * `request-context.ts`; the merged `meta` object then goes through `redact()` before it is
 * written, so a password, token or cookie can never reach a log line by accident (07-security,
 * threat T-2-02). Level: `info` in production, `debug` elsewhere.
 *
 * Format: `'pretty'` only when `NODE_ENV === 'development'` (a colorized single line with the
 * JSON meta appended); `'json'` everywhere else, tests included. Console transport only — file
 * rotation and shipping are erp-infra's (ADR-0021); never add a second transport here.
 *
 * Constructible without Nest (`new LoggerService()`): `main.ts` needs a logger before the
 * container exists, and `PrismaService` defaults to one so the int specs can build it by hand.
 * Inside the container `AppConfig` is injected (global `ConfigModule`) and sets level and format.
 */
import { Injectable, Optional, type LoggerService as NestLoggerService } from '@nestjs/common';
import winston from 'winston';
import { AppConfig } from '../config/app-config.js';
import { redact } from './redact.js';
import { getRequestContext } from './request-context.js';

export type LogMeta = Record<string, unknown>;

export type LogFormat = 'json' | 'pretty';

function prettyFormat(): winston.Logform.Format {
  return winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, ...rest }) => {
      const ts = typeof timestamp === 'string' ? timestamp : '';
      const msg = typeof message === 'string' ? message : JSON.stringify(message);
      return `${ts} ${level} ${msg} ${JSON.stringify(rest)}`;
    }),
  );
}

function jsonFormat(): winston.Logform.Format {
  return winston.format.combine(winston.format.timestamp(), winston.format.json());
}

@Injectable()
export class LoggerService implements NestLoggerService {
  /** `'pretty'` in development only; `'json'` everywhere else (production, test, unset). */
  readonly format: LogFormat;

  private readonly logger: winston.Logger;

  constructor(@Optional() config?: AppConfig) {
    const nodeEnv = config?.env.NODE_ENV;
    this.format = nodeEnv === 'development' ? 'pretty' : 'json';
    this.logger = winston.createLogger({
      level: nodeEnv === 'production' ? 'info' : 'debug',
      format: this.format === 'pretty' ? prettyFormat() : jsonFormat(),
      transports: [new winston.transports.Console()],
    });
  }

  log(message: string, meta?: LogMeta, context?: string): void {
    this.write('info', message, meta, context);
  }

  warn(message: string, meta?: LogMeta, context?: string): void {
    this.write('warn', message, meta, context);
  }

  error(message: string, meta?: LogMeta, context?: string): void {
    this.write('error', message, meta, context);
  }

  debug(message: string, meta?: LogMeta, context?: string): void {
    this.write('debug', message, meta, context);
  }

  private write(level: string, message: string, meta?: LogMeta, context?: string): void {
    const ctx = getRequestContext();
    const merged: LogMeta = {
      ...(ctx
        ? {
            requestId: ctx.requestId,
            ...(ctx.staffId !== undefined ? { staffId: ctx.staffId } : {}),
          }
        : {}),
      ...(meta ?? {}),
    };
    const safe = redact(merged) as LogMeta;
    this.logger.log(level, message, context === undefined ? safe : { ...safe, context });
  }
}
