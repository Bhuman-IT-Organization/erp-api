/**
 * Process entry: Fastify adapter with explicit timeouts, the `x-request-id` hook (first, so the
 * CSRF 403 carries the id too), cookie + CSRF plugins (options from the auth module's public
 * surface), the tus chunk content type (ADR-0041), response compression, the global prefix
 * (health and JWKS excluded), the API docs when `API_DOCS_ENABLED`, the problem-details filter, process-level
 * fatal handlers.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AppConfig } from './shared/config/app-config.js';
import { TIMINGS } from './shared/config/timings.js';
import { ProblemDetailsFilter } from './shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from './shared/http/api-prefix.js';
import { registerCompression } from './shared/http/compression.js';
import { registerFastifyPlugins } from './shared/http/fastify-plugins.js';
import { setupApiDocs } from './shared/http/openapi.js';
import { registerRequestId } from './shared/http/request-id.js';
import { LoggerService } from './shared/logger/logger.service.js';
import { registerTusContentType } from './shared/uploads/tus-content-type.js';
import { AUTH_HTTP_SECURITY } from './v1/auth/index.js';

const FATAL_EXIT_CODE = 1;

// Built directly: the fatal handlers must exist before the Nest container does.
const bootLogger = new LoggerService();

process.on('unhandledRejection', (reason: unknown) => {
  bootLogger.error('fatal: unhandledRejection', {
    error: reason instanceof Error ? reason : { value: String(reason) },
  });
  process.exit(FATAL_EXIT_CODE);
});
process.on('uncaughtException', (error: Error) => {
  bootLogger.error('fatal: uncaughtException', { error });
  process.exit(FATAL_EXIT_CODE);
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // ADR-0031 §4. keepAliveTimeout stays ABOVE Nginx's upstream keepalive_timeout (60 s) so
    // Nginx never reuses a socket Fastify is closing (the classic 502); change both together.
    new FastifyAdapter({
      connectionTimeout: TIMINGS.fastify.connectionTimeoutMs,
      keepAliveTimeout: TIMINGS.fastify.keepAliveTimeoutMs,
      requestTimeout: TIMINGS.fastify.requestTimeoutMs,
    }),
  );
  registerRequestId(app);
  const { env } = app.get(AppConfig);
  await registerFastifyPlugins(app, AUTH_HTTP_SECURITY, { cookieSecure: env.AUTH_COOKIE_SECURE });
  registerTusContentType(app);
  await registerCompression(app);
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
  setupApiDocs(app, env.API_DOCS_ENABLED);
  app.useGlobalFilters(new ProblemDetailsFilter(app.get(LoggerService)));
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  app.get(LoggerService).log('erp-api listening', { port: env.PORT, nodeEnv: env.NODE_ENV });
}

await bootstrap();
